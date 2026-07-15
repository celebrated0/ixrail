"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
  mod2
));

// src/storage/fileStorage.ts
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"));
var import_node_os = __toESM(require("node:os"));
var FileStorage = class {
  constructor(filePath = process.env.IXRAIL_AGENTPAY_STORE ?? import_node_path.default.join(import_node_os.default.homedir(), ".ixrail-agentpay", "store.json")) {
    this.filePath = filePath;
    this.document = this.loadSync();
  }
  document;
  writeQueue = Promise.resolve();
  getState(key, defaultValue) {
    return key in this.document.state ? this.document.state[key] : defaultValue;
  }
  async setState(key, value) {
    this.document.state[key] = value;
    await this.persist();
  }
  async getSecret(key) {
    return this.document.secrets[key];
  }
  async setSecret(key, value) {
    this.document.secrets[key] = value;
    await this.persist();
  }
  async deleteSecret(key) {
    delete this.document.secrets[key];
    await this.persist();
  }
  loadSync() {
    try {
      const raw = (0, import_node_fs.readFileSync)(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (isDocument(parsed))
        return parsed;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
    return { state: {}, secrets: {} };
  }
  persist() {
    this.writeQueue = this.writeQueue.then(async () => {
      await import_node_fs.promises.mkdir(import_node_path.default.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await import_node_fs.promises.writeFile(temporary, JSON.stringify(this.document, null, 2), { mode: 384 });
      await import_node_fs.promises.rename(temporary, this.filePath);
    });
    return this.writeQueue;
  }
};
function isDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const candidate = value;
  return isRecord(candidate.state) && isStringRecord(candidate.secrets);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isStringRecord(value) {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

// src/policy/policyEngine.ts
var import_node_crypto = require("node:crypto");

// src/storage/types.ts
var storageKeys = {
  wallets: "ixrail.agentpay.wallets",
  policies: "ixrail.agentpay.policies",
  spendLog: "ixrail.agentpay.spendLog",
  reservations: "ixrail.agentpay.spendReservations",
  disabledAgents: "ixrail.agentpay.disabledAgents",
  receipts: "ixrail.agentpay.receipts",
  receiptSigner: "ixrail.agentpay.receiptSigner.privateKey",
  walletKey: (walletId) => `ixrail.agentpay.key.${walletId}`
};
var legacyStorageKeys = {
  wallets: "agentpay.wallets",
  policies: "agentpay.policies",
  spendLog: "agentpay.spendLog",
  reservations: "agentpay.spendReservations",
  disabledAgents: "agentpay.disabledAgents",
  receipts: "agentpay.receipts",
  receiptSigner: "agentpay.receiptSigner.privateKey",
  walletKey: (walletId) => `agentpay.key.${walletId}`
};
function readMigratedState(storage, key, legacyKey, defaultValue) {
  const marker = Symbol("missing");
  const current = storage.getState(key, marker);
  return current === marker ? storage.getState(legacyKey, defaultValue) : current;
}
async function readMigratedSecret(storage, key, legacyKey) {
  const current = await storage.getSecret(key);
  if (current !== void 0)
    return current;
  const legacy = await storage.getSecret(legacyKey);
  if (legacy !== void 0)
    await storage.setSecret(key, legacy);
  return legacy;
}

// src/policy/policyEngine.ts
var RESERVATION_TTL_MS = 10 * 6e4;
var PolicyEngine = class {
  constructor(storage) {
    this.storage = storage;
  }
  getPolicy(agentId) {
    return this.policies().find((policy) => policy.agentId === agentId);
  }
  async setPolicy(input) {
    const policy = normalizePolicy({ ...input, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    await this.storage.setState(storageKeys.policies, [...this.policies().filter((item) => item.agentId !== policy.agentId), policy]);
    await this.storage.setState(storageKeys.disabledAgents, this.disabled().filter((id2) => id2 !== policy.agentId));
    return policy;
  }
  async evaluate(intent) {
    await this.pruneReservations();
    return this.evaluateInternal(intent, false);
  }
  async reserveSpend(intent, humanApproved = false) {
    await this.pruneReservations();
    const decision = this.evaluateInternal(intent, humanApproved);
    if (!decision.approved)
      return decision;
    const now = Date.now();
    const reservation = {
      reservationId: `res_${(0, import_node_crypto.randomUUID)().replaceAll("-", "").slice(0, 12)}`,
      intentId: intent.intentId,
      agentId: intent.agentId,
      amountUsd: intent.amountUsd,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RESERVATION_TTL_MS).toISOString()
    };
    await this.storage.setState(storageKeys.reservations, [...this.activeReservations(), reservation]);
    return { ...decision, reservationId: reservation.reservationId };
  }
  async releaseReservation(reservationId) {
    await this.storage.setState(storageKeys.reservations, this.reservations().filter((item) => item.reservationId !== reservationId));
  }
  async recordSpend(agentId, amountUsd, reservationId) {
    const record2 = { agentId, amountUsd, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    if (reservationId !== void 0)
      record2.reservationId = reservationId;
    await this.storage.setState(storageKeys.spendLog, [...this.spendLog(), record2]);
    if (reservationId)
      await this.releaseReservation(reservationId);
  }
  async revokeAgent(agentId) {
    if (!this.disabled().includes(agentId))
      await this.storage.setState(storageKeys.disabledAgents, [...this.disabled(), agentId]);
    await this.storage.setState(storageKeys.reservations, this.reservations().filter((item) => item.agentId !== agentId));
  }
  isAgentRevoked(agentId) {
    return this.disabled().includes(agentId);
  }
  evaluateInternal(intent, humanApproved) {
    const policy = this.getPolicy(intent.agentId);
    if (!policy)
      return deny("No spending policy configured for this agent");
    if (this.isAgentRevoked(intent.agentId))
      return deny("Agent access has been revoked");
    if (!Number.isFinite(intent.amountUsd) || intent.amountUsd <= 0)
      return deny("Payment amount must be positive");
    if (new Date(intent.expiresAt).getTime() <= Date.now())
      return deny("Payment intent has expired");
    const merchant = normalizePrincipal(intent.merchantDomain);
    const recipient = normalizePrincipal(intent.recipient);
    if (policy.blocklist.includes(merchant) || policy.blocklist.includes(recipient))
      return deny("Merchant or recipient is blocklisted");
    if (policy.allowlist.length && !policy.allowlist.includes(merchant) && !policy.allowlist.includes(recipient))
      return deny("Merchant is not allowlisted");
    if (intent.amountUsd > policy.perTxCapUsd)
      return deny(`Amount exceeds per-transaction cap of $${policy.perTxCapUsd}`);
    if (this.windowTotal(intent.agentId, "day") + intent.amountUsd > policy.dailyCapUsd)
      return deny(`Would exceed daily cap of $${policy.dailyCapUsd}`);
    if (this.windowTotal(intent.agentId, "month") + intent.amountUsd > policy.monthlyCapUsd)
      return deny(`Would exceed monthly cap of $${policy.monthlyCapUsd}`);
    if (!humanApproved && intent.amountUsd >= policy.approvalThresholdUsd) {
      return { approved: false, requiresHumanApproval: true, reason: "Amount requires human approval" };
    }
    return { approved: true, requiresHumanApproval: false, reason: "Within policy" };
  }
  windowTotal(agentId, window) {
    const now = /* @__PURE__ */ new Date();
    const spent = this.spendLog().filter((item) => item.agentId === agentId && sameWindow(new Date(item.timestamp), now, window));
    const reserved = this.activeReservations().filter((item) => item.agentId === agentId && sameWindow(new Date(item.createdAt), now, window));
    return [...spent, ...reserved].reduce((total, item) => total + item.amountUsd, 0);
  }
  policies = () => readMigratedState(this.storage, storageKeys.policies, legacyStorageKeys.policies, []);
  spendLog = () => readMigratedState(this.storage, storageKeys.spendLog, legacyStorageKeys.spendLog, []);
  reservations = () => readMigratedState(this.storage, storageKeys.reservations, legacyStorageKeys.reservations, []);
  disabled = () => readMigratedState(this.storage, storageKeys.disabledAgents, legacyStorageKeys.disabledAgents, []);
  activeReservations = () => this.reservations().filter((item) => new Date(item.expiresAt).getTime() > Date.now());
  async pruneReservations() {
    const active = this.activeReservations();
    if (active.length !== this.reservations().length)
      await this.storage.setState(storageKeys.reservations, active);
  }
};
function normalizePolicy(policy) {
  for (const [name, value] of Object.entries({
    perTxCapUsd: policy.perTxCapUsd,
    dailyCapUsd: policy.dailyCapUsd,
    monthlyCapUsd: policy.monthlyCapUsd,
    approvalThresholdUsd: policy.approvalThresholdUsd
  }))
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`${name} must be finite and non-negative`);
  if (policy.perTxCapUsd <= 0 || policy.dailyCapUsd < policy.perTxCapUsd || policy.monthlyCapUsd < policy.dailyCapUsd)
    throw new Error("Caps must be positive and ordered per-transaction <= daily <= monthly");
  if (policy.approvalThresholdUsd > policy.perTxCapUsd)
    throw new Error("Approval threshold cannot exceed per-transaction cap");
  return { ...policy, agentId: policy.agentId.trim(), allowlist: policy.allowlist.map(normalizePrincipal).filter(Boolean), blocklist: policy.blocklist.map(normalizePrincipal).filter(Boolean) };
}
var normalizePrincipal = (value) => value.trim().toLowerCase();
var deny = (reason) => ({ approved: false, requiresHumanApproval: false, reason });
function sameWindow(value, now, window) {
  const month = value.getUTCFullYear() === now.getUTCFullYear() && value.getUTCMonth() === now.getUTCMonth();
  return month && (window === "month" || value.getUTCDate() === now.getUTCDate());
}

// node_modules/ethers/lib.esm/_version.js
var version = "6.17.0";

// node_modules/ethers/lib.esm/utils/properties.js
function checkType(value, type, name) {
  const types = type.split("|").map((t) => t.trim());
  for (let i = 0; i < types.length; i++) {
    switch (type) {
      case "any":
        return;
      case "bigint":
      case "boolean":
      case "number":
      case "string":
        if (typeof value === type) {
          return;
        }
    }
  }
  const error = new Error(`invalid value for type ${type}`);
  error.code = "INVALID_ARGUMENT";
  error.argument = `value.${name}`;
  error.value = value;
  throw error;
}
async function resolveProperties(value) {
  const keys = Object.keys(value);
  const results = await Promise.all(keys.map((k) => Promise.resolve(value[k])));
  return results.reduce((accum, v, index) => {
    accum[keys[index]] = v;
    return accum;
  }, {});
}
function defineProperties(target, values, types) {
  for (let key in values) {
    let value = values[key];
    const type = types ? types[key] : null;
    if (type) {
      checkType(value, type, key);
    }
    Object.defineProperty(target, key, { enumerable: true, value, writable: false });
  }
}

// node_modules/ethers/lib.esm/utils/errors.js
function stringify(value, seen) {
  if (value == null) {
    return "null";
  }
  if (seen == null) {
    seen = /* @__PURE__ */ new Set();
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
  }
  if (Array.isArray(value)) {
    return "[ " + value.map((v) => stringify(v, seen)).join(", ") + " ]";
  }
  if (value instanceof Uint8Array) {
    const HEX = "0123456789abcdef";
    let result2 = "0x";
    for (let i = 0; i < value.length; i++) {
      result2 += HEX[value[i] >> 4];
      result2 += HEX[value[i] & 15];
    }
    return result2;
  }
  if (typeof value === "object" && typeof value.toJSON === "function") {
    return stringify(value.toJSON(), seen);
  }
  switch (typeof value) {
    case "boolean":
    case "number":
    case "symbol":
      return value.toString();
    case "bigint":
      return BigInt(value).toString();
    case "string":
      return JSON.stringify(value);
    case "object": {
      const keys = Object.keys(value);
      keys.sort();
      return "{ " + keys.map((k) => `${stringify(k, seen)}: ${stringify(value[k], seen)}`).join(", ") + " }";
    }
  }
  return `[ COULD NOT SERIALIZE ]`;
}
function isError(error, code) {
  return error && error.code === code;
}
function isCallException(error) {
  return isError(error, "CALL_EXCEPTION");
}
function makeError(message, code, info) {
  let shortMessage = message;
  {
    const details = [];
    if (info) {
      if ("message" in info || "code" in info || "name" in info) {
        throw new Error(`value will overwrite populated values: ${stringify(info)}`);
      }
      for (const key in info) {
        if (key === "shortMessage") {
          continue;
        }
        const value = info[key];
        details.push(key + "=" + stringify(value));
      }
    }
    details.push(`code=${code}`);
    details.push(`version=${version}`);
    if (details.length) {
      message += " (" + details.join(", ") + ")";
    }
  }
  let error;
  switch (code) {
    case "INVALID_ARGUMENT":
      error = new TypeError(message);
      break;
    case "NUMERIC_FAULT":
    case "BUFFER_OVERRUN":
      error = new RangeError(message);
      break;
    default:
      error = new Error(message);
  }
  defineProperties(error, { code });
  if (info) {
    Object.assign(error, info);
  }
  if (error.shortMessage == null) {
    defineProperties(error, { shortMessage });
  }
  return error;
}
function assert(check, message, code, info) {
  if (!check) {
    throw makeError(message, code, info);
  }
}
function assertArgument(check, message, name, value) {
  assert(check, message, "INVALID_ARGUMENT", { argument: name, value });
}
function assertArgumentCount(count, expectedCount, message) {
  if (message == null) {
    message = "";
  }
  if (message) {
    message = ": " + message;
  }
  assert(count >= expectedCount, "missing argument" + message, "MISSING_ARGUMENT", {
    count,
    expectedCount
  });
  assert(count <= expectedCount, "too many arguments" + message, "UNEXPECTED_ARGUMENT", {
    count,
    expectedCount
  });
}
var _normalizeForms = ["NFD", "NFC", "NFKD", "NFKC"].reduce((accum, form) => {
  try {
    if ("test".normalize(form) !== "test") {
      throw new Error("bad");
    }
    ;
    if (form === "NFD") {
      const check = String.fromCharCode(233).normalize("NFD");
      const expected = String.fromCharCode(101, 769);
      if (check !== expected) {
        throw new Error("broken");
      }
    }
    accum.push(form);
  } catch (error) {
  }
  return accum;
}, []);
function assertNormalize(form) {
  assert(_normalizeForms.indexOf(form) >= 0, "platform missing String.prototype.normalize", "UNSUPPORTED_OPERATION", {
    operation: "String.prototype.normalize",
    info: { form }
  });
}
function assertPrivate(givenGuard, guard, className) {
  if (className == null) {
    className = "";
  }
  if (givenGuard !== guard) {
    let method = className, operation = "new";
    if (className) {
      method += ".";
      operation += " " + className;
    }
    assert(false, `private constructor; use ${method}from* methods`, "UNSUPPORTED_OPERATION", {
      operation
    });
  }
}

// node_modules/ethers/lib.esm/utils/data.js
function _getBytes(value, name, copy4) {
  if (value instanceof Uint8Array) {
    if (copy4) {
      return new Uint8Array(value);
    }
    return value;
  }
  if (typeof value === "string" && value.length % 2 === 0 && value.match(/^0x[0-9a-f]*$/i)) {
    const result2 = new Uint8Array((value.length - 2) / 2);
    let offset = 2;
    for (let i = 0; i < result2.length; i++) {
      result2[i] = parseInt(value.substring(offset, offset + 2), 16);
      offset += 2;
    }
    return result2;
  }
  assertArgument(false, "invalid BytesLike value", name || "value", value);
}
function getBytes(value, name) {
  return _getBytes(value, name, false);
}
function getBytesCopy(value, name) {
  return _getBytes(value, name, true);
}
function isHexString(value, length) {
  if (typeof value !== "string" || !value.match(/^0x[0-9A-Fa-f]*$/)) {
    return false;
  }
  if (typeof length === "number" && value.length !== 2 + 2 * length) {
    return false;
  }
  if (length === true && value.length % 2 !== 0) {
    return false;
  }
  return true;
}
function isBytesLike(value) {
  return isHexString(value, true) || value instanceof Uint8Array;
}
var HexCharacters = "0123456789abcdef";
function hexlify(data) {
  const bytes2 = getBytes(data);
  let result2 = "0x";
  for (let i = 0; i < bytes2.length; i++) {
    const v = bytes2[i];
    result2 += HexCharacters[(v & 240) >> 4] + HexCharacters[v & 15];
  }
  return result2;
}
function concat(datas) {
  return "0x" + datas.map((d) => hexlify(d).substring(2)).join("");
}
function dataLength(data) {
  if (isHexString(data, true)) {
    return (data.length - 2) / 2;
  }
  return getBytes(data).length;
}
function dataSlice(data, start, end) {
  const bytes2 = getBytes(data);
  if (end != null && end > bytes2.length) {
    assert(false, "cannot slice beyond data bounds", "BUFFER_OVERRUN", {
      buffer: bytes2,
      length: bytes2.length,
      offset: end
    });
  }
  return hexlify(bytes2.slice(start == null ? 0 : start, end == null ? bytes2.length : end));
}
function zeroPad(data, length, left) {
  const bytes2 = getBytes(data);
  assert(length >= bytes2.length, "padding exceeds data length", "BUFFER_OVERRUN", {
    buffer: new Uint8Array(bytes2),
    length,
    offset: length + 1
  });
  const result2 = new Uint8Array(length);
  result2.fill(0);
  if (left) {
    result2.set(bytes2, length - bytes2.length);
  } else {
    result2.set(bytes2, 0);
  }
  return hexlify(result2);
}
function zeroPadValue(data, length) {
  return zeroPad(data, length, true);
}
function zeroPadBytes(data, length) {
  return zeroPad(data, length, false);
}

// node_modules/ethers/lib.esm/utils/maths.js
var BN_0 = BigInt(0);
var BN_1 = BigInt(1);
var maxValue = 9007199254740991;
function fromTwos(_value, _width) {
  const value = getUint(_value, "value");
  const width = BigInt(getNumber(_width, "width"));
  assert(value >> width === BN_0, "overflow", "NUMERIC_FAULT", {
    operation: "fromTwos",
    fault: "overflow",
    value: _value
  });
  if (value >> width - BN_1) {
    const mask2 = (BN_1 << width) - BN_1;
    return -((~value & mask2) + BN_1);
  }
  return value;
}
function toTwos(_value, _width) {
  let value = getBigInt(_value, "value");
  const width = BigInt(getNumber(_width, "width"));
  const limit = BN_1 << width - BN_1;
  if (value < BN_0) {
    value = -value;
    assert(value <= limit, "too low", "NUMERIC_FAULT", {
      operation: "toTwos",
      fault: "overflow",
      value: _value
    });
    const mask2 = (BN_1 << width) - BN_1;
    return (~value & mask2) + BN_1;
  } else {
    assert(value < limit, "too high", "NUMERIC_FAULT", {
      operation: "toTwos",
      fault: "overflow",
      value: _value
    });
  }
  return value;
}
function mask(_value, _bits) {
  const value = getUint(_value, "value");
  const bits = BigInt(getNumber(_bits, "bits"));
  return value & (BN_1 << bits) - BN_1;
}
function getBigInt(value, name) {
  switch (typeof value) {
    case "bigint":
      return value;
    case "number":
      assertArgument(Number.isInteger(value), "underflow", name || "value", value);
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return BigInt(value);
    case "string":
      try {
        if (value === "") {
          throw new Error("empty string");
        }
        if (value[0] === "-" && value[1] !== "-") {
          return -BigInt(value.substring(1));
        }
        return BigInt(value);
      } catch (e) {
        assertArgument(false, `invalid BigNumberish string: ${e.message}`, name || "value", value);
      }
  }
  assertArgument(false, "invalid BigNumberish value", name || "value", value);
}
function getUint(value, name) {
  const result2 = getBigInt(value, name);
  assert(result2 >= BN_0, "unsigned value cannot be negative", "NUMERIC_FAULT", {
    fault: "overflow",
    operation: "getUint",
    value
  });
  return result2;
}
var Nibbles = "0123456789abcdef";
function toBigInt(value) {
  if (value instanceof Uint8Array) {
    let result2 = "0x0";
    for (const v of value) {
      result2 += Nibbles[v >> 4];
      result2 += Nibbles[v & 15];
    }
    return BigInt(result2);
  }
  return getBigInt(value);
}
function getNumber(value, name) {
  switch (typeof value) {
    case "bigint":
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return Number(value);
    case "number":
      assertArgument(Number.isInteger(value), "underflow", name || "value", value);
      assertArgument(value >= -maxValue && value <= maxValue, "overflow", name || "value", value);
      return value;
    case "string":
      try {
        if (value === "") {
          throw new Error("empty string");
        }
        return getNumber(BigInt(value), name);
      } catch (e) {
        assertArgument(false, `invalid numeric string: ${e.message}`, name || "value", value);
      }
  }
  assertArgument(false, "invalid numeric value", name || "value", value);
}
function toNumber(value) {
  return getNumber(toBigInt(value));
}
function toBeHex(_value, _width) {
  const value = getUint(_value, "value");
  let result2 = value.toString(16);
  if (_width == null) {
    if (result2.length % 2) {
      result2 = "0" + result2;
    }
  } else {
    const width = getNumber(_width, "width");
    if (width === 0 && value === BN_0) {
      return "0x";
    }
    assert(width * 2 >= result2.length, `value exceeds width (${width} bytes)`, "NUMERIC_FAULT", {
      operation: "toBeHex",
      fault: "overflow",
      value: _value
    });
    while (result2.length < width * 2) {
      result2 = "0" + result2;
    }
  }
  return "0x" + result2;
}
function toBeArray(_value, _width) {
  const value = getUint(_value, "value");
  if (value === BN_0) {
    const width = _width != null ? getNumber(_width, "width") : 0;
    return new Uint8Array(width);
  }
  let hex = value.toString(16);
  if (hex.length % 2) {
    hex = "0" + hex;
  }
  if (_width != null) {
    const width = getNumber(_width, "width");
    while (hex.length < width * 2) {
      hex = "00" + hex;
    }
    assert(width * 2 === hex.length, `value exceeds width (${width} bytes)`, "NUMERIC_FAULT", {
      operation: "toBeArray",
      fault: "overflow",
      value: _value
    });
  }
  const result2 = new Uint8Array(hex.length / 2);
  for (let i = 0; i < result2.length; i++) {
    const offset = i * 2;
    result2[i] = parseInt(hex.substring(offset, offset + 2), 16);
  }
  return result2;
}
function toQuantity(value) {
  let result2 = hexlify(isBytesLike(value) ? value : toBeArray(value)).substring(2);
  while (result2.startsWith("0")) {
    result2 = result2.substring(1);
  }
  if (result2 === "") {
    result2 = "0";
  }
  return "0x" + result2;
}

// node_modules/ethers/lib.esm/utils/base58.js
var Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
var Lookup = null;
function getAlpha(letter) {
  if (Lookup == null) {
    Lookup = {};
    for (let i = 0; i < Alphabet.length; i++) {
      Lookup[Alphabet[i]] = BigInt(i);
    }
  }
  const result2 = Lookup[letter];
  assertArgument(result2 != null, `invalid base58 value`, "letter", letter);
  return result2;
}
var BN_02 = BigInt(0);
var BN_58 = BigInt(58);
function encodeBase58(_value) {
  const bytes2 = getBytes(_value);
  let value = toBigInt(bytes2);
  let result2 = "";
  while (value) {
    result2 = Alphabet[Number(value % BN_58)] + result2;
    value /= BN_58;
  }
  for (let i = 0; i < bytes2.length; i++) {
    if (bytes2[i]) {
      break;
    }
    result2 = Alphabet[0] + result2;
  }
  return result2;
}
function decodeBase58(value) {
  let result2 = BN_02;
  for (let i = 0; i < value.length; i++) {
    result2 *= BN_58;
    result2 += getAlpha(value[i]);
  }
  return result2;
}

// node_modules/ethers/lib.esm/utils/base64.js
function decodeBase64(value) {
  return getBytesCopy(Buffer.from(value, "base64"));
}
function encodeBase64(data) {
  return Buffer.from(getBytes(data)).toString("base64");
}

// node_modules/ethers/lib.esm/utils/events.js
var EventPayload = class {
  /**
   *  The event filter.
   */
  filter;
  /**
   *  The **EventEmitterable**.
   */
  emitter;
  #listener;
  /**
   *  Create a new **EventPayload** for %%emitter%% with
   *  the %%listener%% and for %%filter%%.
   */
  constructor(emitter, listener, filter) {
    this.#listener = listener;
    defineProperties(this, { emitter, filter });
  }
  /**
   *  Unregister the triggered listener for future events.
   */
  async removeListener() {
    if (this.#listener == null) {
      return;
    }
    await this.emitter.off(this.filter, this.#listener);
  }
};

// node_modules/ethers/lib.esm/utils/utf8.js
function errorFunc(reason, offset, bytes2, output2, badCodepoint) {
  assertArgument(false, `invalid codepoint at offset ${offset}; ${reason}`, "bytes", bytes2);
}
function ignoreFunc(reason, offset, bytes2, output2, badCodepoint) {
  if (reason === "BAD_PREFIX" || reason === "UNEXPECTED_CONTINUE") {
    let i = 0;
    for (let o = offset + 1; o < bytes2.length; o++) {
      if (bytes2[o] >> 6 !== 2) {
        break;
      }
      i++;
    }
    return i;
  }
  if (reason === "OVERRUN") {
    return bytes2.length - offset - 1;
  }
  return 0;
}
function replaceFunc(reason, offset, bytes2, output2, badCodepoint) {
  if (reason === "OVERLONG") {
    assertArgument(typeof badCodepoint === "number", "invalid bad code point for replacement", "badCodepoint", badCodepoint);
    output2.push(badCodepoint);
    return 0;
  }
  output2.push(65533);
  return ignoreFunc(reason, offset, bytes2, output2, badCodepoint);
}
var Utf8ErrorFuncs = Object.freeze({
  error: errorFunc,
  ignore: ignoreFunc,
  replace: replaceFunc
});
function getUtf8CodePoints(_bytes, onError) {
  if (onError == null) {
    onError = Utf8ErrorFuncs.error;
  }
  const bytes2 = getBytes(_bytes, "bytes");
  const result2 = [];
  let i = 0;
  while (i < bytes2.length) {
    const c = bytes2[i++];
    if (c >> 7 === 0) {
      result2.push(c);
      continue;
    }
    let extraLength = null;
    let overlongMask = null;
    if ((c & 224) === 192) {
      extraLength = 1;
      overlongMask = 127;
    } else if ((c & 240) === 224) {
      extraLength = 2;
      overlongMask = 2047;
    } else if ((c & 248) === 240) {
      extraLength = 3;
      overlongMask = 65535;
    } else {
      if ((c & 192) === 128) {
        i += onError("UNEXPECTED_CONTINUE", i - 1, bytes2, result2);
      } else {
        i += onError("BAD_PREFIX", i - 1, bytes2, result2);
      }
      continue;
    }
    if (i - 1 + extraLength >= bytes2.length) {
      i += onError("OVERRUN", i - 1, bytes2, result2);
      continue;
    }
    let res = c & (1 << 8 - extraLength - 1) - 1;
    for (let j = 0; j < extraLength; j++) {
      let nextChar = bytes2[i];
      if ((nextChar & 192) != 128) {
        i += onError("MISSING_CONTINUE", i, bytes2, result2);
        res = null;
        break;
      }
      ;
      res = res << 6 | nextChar & 63;
      i++;
    }
    if (res === null) {
      continue;
    }
    if (res > 1114111) {
      i += onError("OUT_OF_RANGE", i - 1 - extraLength, bytes2, result2, res);
      continue;
    }
    if (res >= 55296 && res <= 57343) {
      i += onError("UTF16_SURROGATE", i - 1 - extraLength, bytes2, result2, res);
      continue;
    }
    if (res <= overlongMask) {
      i += onError("OVERLONG", i - 1 - extraLength, bytes2, result2, res);
      continue;
    }
    result2.push(res);
  }
  return result2;
}
function toUtf8Bytes(str, form) {
  assertArgument(typeof str === "string", "invalid string value", "str", str);
  if (form != null) {
    assertNormalize(form);
    str = str.normalize(form);
  }
  let result2 = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) {
      result2.push(c);
    } else if (c < 2048) {
      result2.push(c >> 6 | 192);
      result2.push(c & 63 | 128);
    } else if ((c & 64512) == 55296) {
      i++;
      const c2 = str.charCodeAt(i);
      assertArgument(i < str.length && (c2 & 64512) === 56320, "invalid surrogate pair", "str", str);
      const pair = 65536 + ((c & 1023) << 10) + (c2 & 1023);
      result2.push(pair >> 18 | 240);
      result2.push(pair >> 12 & 63 | 128);
      result2.push(pair >> 6 & 63 | 128);
      result2.push(pair & 63 | 128);
    } else {
      result2.push(c >> 12 | 224);
      result2.push(c >> 6 & 63 | 128);
      result2.push(c & 63 | 128);
    }
  }
  return new Uint8Array(result2);
}
function _toUtf8String(codePoints) {
  return codePoints.map((codePoint) => {
    if (codePoint <= 65535) {
      return String.fromCharCode(codePoint);
    }
    codePoint -= 65536;
    return String.fromCharCode((codePoint >> 10 & 1023) + 55296, (codePoint & 1023) + 56320);
  }).join("");
}
function toUtf8String(bytes2, onError) {
  return _toUtf8String(getUtf8CodePoints(bytes2, onError));
}

// node_modules/ethers/lib.esm/utils/geturl.js
var import_http = __toESM(require("http"), 1);
var import_https = __toESM(require("https"), 1);
var import_zlib = require("zlib");
function createGetUrl(options2) {
  async function getUrl(req, signal) {
    assert(signal == null || !signal.cancelled, "request cancelled before sending", "CANCELLED");
    const protocol = req.url.split(":")[0].toLowerCase();
    assert(protocol === "http" || protocol === "https", `unsupported protocol ${protocol}`, "UNSUPPORTED_OPERATION", {
      info: { protocol },
      operation: "request"
    });
    assert(protocol === "https" || !req.credentials || req.allowInsecureAuthentication, "insecure authorized connections unsupported", "UNSUPPORTED_OPERATION", {
      operation: "request"
    });
    const method = req.method;
    const headers = Object.assign({}, req.headers);
    const reqOptions = { method, headers };
    if (options2) {
      if (options2.agent) {
        reqOptions.agent = options2.agent;
      }
    }
    let abort = null;
    try {
      abort = new AbortController();
      reqOptions.abort = abort.signal;
    } catch (e) {
      console.log(e);
    }
    const request = (protocol === "http" ? import_http.default : import_https.default).request(req.url, reqOptions);
    request.setTimeout(req.timeout);
    const body = req.body;
    if (body) {
      request.write(Buffer.from(body));
    }
    request.end();
    return new Promise((resolve, reject) => {
      if (signal) {
        signal.addListener(() => {
          if (abort) {
            abort.abort();
          }
          reject(makeError("request cancelled", "CANCELLED"));
        });
      }
      request.on("timeout", () => {
        reject(makeError("request timeout", "TIMEOUT"));
      });
      request.once("response", (resp) => {
        const statusCode = resp.statusCode || 0;
        const statusMessage = resp.statusMessage || "";
        const headers2 = Object.keys(resp.headers || {}).reduce((accum, name) => {
          let value = resp.headers[name] || "";
          if (Array.isArray(value)) {
            value = value.join(", ");
          }
          accum[name] = value;
          return accum;
        }, {});
        let body2 = null;
        resp.on("data", (chunk) => {
          if (signal) {
            try {
              signal.checkSignal();
            } catch (error) {
              return reject(error);
            }
          }
          if (body2 == null) {
            body2 = chunk;
          } else {
            const newBody = new Uint8Array(body2.length + chunk.length);
            newBody.set(body2, 0);
            newBody.set(chunk, body2.length);
            body2 = newBody;
          }
        });
        resp.on("end", () => {
          try {
            if (headers2["content-encoding"] === "gzip" && body2) {
              body2 = getBytes((0, import_zlib.gunzipSync)(body2));
            }
            resolve({ statusCode, statusMessage, headers: headers2, body: body2 });
          } catch (error) {
            reject(makeError("bad response data", "SERVER_ERROR", {
              request: req,
              info: { response: resp, error }
            }));
          }
        });
        resp.on("error", (error) => {
          error.response = { statusCode, statusMessage, headers: headers2, body: body2 };
          reject(error);
        });
      });
      request.on("error", (error) => {
        reject(error);
      });
    });
  }
  return getUrl;
}
var defaultGetUrl = createGetUrl({});

// node_modules/ethers/lib.esm/utils/fetch.js
var MAX_ATTEMPTS = 12;
var SLOT_INTERVAL = 250;
var defaultGetUrlFunc = createGetUrl();
var reData = new RegExp("^data:([^;:]*)?(;base64)?,(.*)$", "i");
var reIpfs = new RegExp("^ipfs://(ipfs/)?(.*)$", "i");
var locked = false;
async function dataGatewayFunc(url, signal) {
  try {
    const match = url.match(reData);
    if (!match) {
      throw new Error("invalid data");
    }
    return new FetchResponse(200, "OK", {
      "content-type": match[1] || "text/plain"
    }, match[2] ? decodeBase64(match[3]) : unpercent(match[3]));
  } catch (error) {
    return new FetchResponse(599, "BAD REQUEST (invalid data: URI)", {}, null, new FetchRequest(url));
  }
}
function getIpfsGatewayFunc(baseUrl) {
  async function gatewayIpfs(url, signal) {
    try {
      const match = url.match(reIpfs);
      if (!match) {
        throw new Error("invalid link");
      }
      return new FetchRequest(`${baseUrl}${match[2]}`);
    } catch (error) {
      return new FetchResponse(599, "BAD REQUEST (invalid IPFS URI)", {}, null, new FetchRequest(url));
    }
  }
  return gatewayIpfs;
}
var Gateways = {
  "data": dataGatewayFunc,
  "ipfs": getIpfsGatewayFunc("https://gateway.ipfs.io/ipfs/")
};
var fetchSignals = /* @__PURE__ */ new WeakMap();
var FetchCancelSignal = class {
  #listeners;
  #cancelled;
  constructor(request) {
    this.#listeners = [];
    this.#cancelled = false;
    fetchSignals.set(request, () => {
      if (this.#cancelled) {
        return;
      }
      this.#cancelled = true;
      for (const listener of this.#listeners) {
        setTimeout(() => {
          listener();
        }, 0);
      }
      this.#listeners = [];
    });
  }
  addListener(listener) {
    assert(!this.#cancelled, "singal already cancelled", "UNSUPPORTED_OPERATION", {
      operation: "fetchCancelSignal.addCancelListener"
    });
    this.#listeners.push(listener);
  }
  get cancelled() {
    return this.#cancelled;
  }
  checkSignal() {
    assert(!this.cancelled, "cancelled", "CANCELLED", {});
  }
};
function checkSignal(signal) {
  if (signal == null) {
    throw new Error("missing signal; should not happen");
  }
  signal.checkSignal();
  return signal;
}
var FetchRequest = class _FetchRequest {
  #allowInsecure;
  #gzip;
  #headers;
  #method;
  #timeout;
  #url;
  #body;
  #bodyType;
  #creds;
  // Hooks
  #preflight;
  #process;
  #retry;
  #signal;
  #throttle;
  #getUrlFunc;
  /**
   *  The fetch URL to request.
   */
  get url() {
    return this.#url;
  }
  set url(url) {
    this.#url = String(url);
  }
  /**
   *  The fetch body, if any, to send as the request body. //(default: null)//
   *
   *  When setting a body, the intrinsic ``Content-Type`` is automatically
   *  set and will be used if **not overridden** by setting a custom
   *  header.
   *
   *  If %%body%% is null, the body is cleared (along with the
   *  intrinsic ``Content-Type``).
   *
   *  If %%body%% is a string, the intrinsic ``Content-Type`` is set to
   *  ``text/plain``.
   *
   *  If %%body%% is a Uint8Array, the intrinsic ``Content-Type`` is set to
   *  ``application/octet-stream``.
   *
   *  If %%body%% is any other object, the intrinsic ``Content-Type`` is
   *  set to ``application/json``.
   */
  get body() {
    if (this.#body == null) {
      return null;
    }
    return new Uint8Array(this.#body);
  }
  set body(body) {
    if (body == null) {
      this.#body = void 0;
      this.#bodyType = void 0;
    } else if (typeof body === "string") {
      this.#body = toUtf8Bytes(body);
      this.#bodyType = "text/plain";
    } else if (body instanceof Uint8Array) {
      this.#body = body;
      this.#bodyType = "application/octet-stream";
    } else if (typeof body === "object") {
      this.#body = toUtf8Bytes(JSON.stringify(body));
      this.#bodyType = "application/json";
    } else {
      throw new Error("invalid body");
    }
  }
  /**
   *  Returns true if the request has a body.
   */
  hasBody() {
    return this.#body != null;
  }
  /**
   *  The HTTP method to use when requesting the URI. If no method
   *  has been explicitly set, then ``GET`` is used if the body is
   *  null and ``POST`` otherwise.
   */
  get method() {
    if (this.#method) {
      return this.#method;
    }
    if (this.hasBody()) {
      return "POST";
    }
    return "GET";
  }
  set method(method) {
    if (method == null) {
      method = "";
    }
    this.#method = String(method).toUpperCase();
  }
  /**
   *  The headers that will be used when requesting the URI. All
   *  keys are lower-case.
   *
   *  This object is a copy, so any changes will **NOT** be reflected
   *  in the ``FetchRequest``.
   *
   *  To set a header entry, use the ``setHeader`` method.
   */
  get headers() {
    const headers = Object.assign({}, this.#headers);
    if (this.#creds) {
      headers["authorization"] = `Basic ${encodeBase64(toUtf8Bytes(this.#creds))}`;
    }
    ;
    if (this.allowGzip) {
      headers["accept-encoding"] = "gzip";
    }
    if (headers["content-type"] == null && this.#bodyType) {
      headers["content-type"] = this.#bodyType;
    }
    if (this.body) {
      headers["content-length"] = String(this.body.length);
    }
    return headers;
  }
  /**
   *  Get the header for %%key%%, ignoring case.
   */
  getHeader(key) {
    return this.headers[key.toLowerCase()];
  }
  /**
   *  Set the header for %%key%% to %%value%%. All values are coerced
   *  to a string.
   */
  setHeader(key, value) {
    this.#headers[String(key).toLowerCase()] = String(value);
  }
  /**
   *  Clear all headers, resetting all intrinsic headers.
   */
  clearHeaders() {
    this.#headers = {};
  }
  [Symbol.iterator]() {
    const headers = this.headers;
    const keys = Object.keys(headers);
    let index = 0;
    return {
      next: () => {
        if (index < keys.length) {
          const key = keys[index++];
          return {
            value: [key, headers[key]],
            done: false
          };
        }
        return { value: void 0, done: true };
      }
    };
  }
  /**
   *  The value that will be sent for the ``Authorization`` header.
   *
   *  To set the credentials, use the ``setCredentials`` method.
   */
  get credentials() {
    return this.#creds || null;
  }
  /**
   *  Sets an ``Authorization`` for %%username%% with %%password%%.
   */
  setCredentials(username, password) {
    assertArgument(!username.match(/:/), "invalid basic authentication username", "username", "[REDACTED]");
    this.#creds = `${username}:${password}`;
  }
  /**
   *  Enable and request gzip-encoded responses. The response will
   *  automatically be decompressed. //(default: true)//
   */
  get allowGzip() {
    return this.#gzip;
  }
  set allowGzip(value) {
    this.#gzip = !!value;
  }
  /**
   *  Allow ``Authentication`` credentials to be sent over insecure
   *  channels. //(default: false)//
   */
  get allowInsecureAuthentication() {
    return !!this.#allowInsecure;
  }
  set allowInsecureAuthentication(value) {
    this.#allowInsecure = !!value;
  }
  /**
   *  The timeout (in milliseconds) to wait for a complete response.
   *  //(default: 5 minutes)//
   */
  get timeout() {
    return this.#timeout;
  }
  set timeout(timeout) {
    assertArgument(timeout >= 0, "timeout must be non-zero", "timeout", timeout);
    this.#timeout = timeout;
  }
  /**
   *  This function is called prior to each request, for example
   *  during a redirection or retry in case of server throttling.
   *
   *  This offers an opportunity to populate headers or update
   *  content before sending a request.
   */
  get preflightFunc() {
    return this.#preflight || null;
  }
  set preflightFunc(preflight) {
    this.#preflight = preflight;
  }
  /**
   *  This function is called after each response, offering an
   *  opportunity to provide client-level throttling or updating
   *  response data.
   *
   *  Any error thrown in this causes the ``send()`` to throw.
   *
   *  To schedule a retry attempt (assuming the maximum retry limit
   *  has not been reached), use [[response.throwThrottleError]].
   */
  get processFunc() {
    return this.#process || null;
  }
  set processFunc(process2) {
    this.#process = process2;
  }
  /**
   *  This function is called on each retry attempt.
   */
  get retryFunc() {
    return this.#retry || null;
  }
  set retryFunc(retry) {
    this.#retry = retry;
  }
  /**
   *  This function is called to fetch content from HTTP and
   *  HTTPS URLs and is platform specific (e.g. nodejs vs
   *  browsers).
   *
   *  This is by default the currently registered global getUrl
   *  function, which can be changed using [[registerGetUrl]].
   *  If this has been set, setting is to ``null`` will cause
   *  this FetchRequest (and any future clones) to revert back to
   *  using the currently registered global getUrl function.
   *
   *  Setting this is generally not necessary, but may be useful
   *  for developers that wish to intercept requests or to
   *  configurege a proxy or other agent.
   */
  get getUrlFunc() {
    return this.#getUrlFunc || defaultGetUrlFunc;
  }
  set getUrlFunc(value) {
    this.#getUrlFunc = value;
  }
  /**
   *  Create a new FetchRequest instance with default values.
   *
   *  Once created, each property may be set before issuing a
   *  ``.send()`` to make the request.
   */
  constructor(url) {
    this.#url = String(url);
    this.#allowInsecure = false;
    this.#gzip = true;
    this.#headers = {};
    this.#method = "";
    this.#timeout = 3e5;
    this.#throttle = {
      slotInterval: SLOT_INTERVAL,
      maxAttempts: MAX_ATTEMPTS
    };
    this.#getUrlFunc = null;
  }
  toString() {
    return `<FetchRequest method=${JSON.stringify(this.method)} url=${JSON.stringify(this.url)} headers=${JSON.stringify(this.headers)} body=${this.#body ? hexlify(this.#body) : "null"}>`;
  }
  /**
   *  Update the throttle parameters used to determine maximum
   *  attempts and exponential-backoff properties.
   */
  setThrottleParams(params) {
    if (params.slotInterval != null) {
      this.#throttle.slotInterval = params.slotInterval;
    }
    if (params.maxAttempts != null) {
      this.#throttle.maxAttempts = params.maxAttempts;
    }
  }
  async #send(attempt, expires, delay, _request, _response) {
    if (attempt >= this.#throttle.maxAttempts) {
      return _response.makeServerError("exceeded maximum retry limit");
    }
    assert(getTime() <= expires, "timeout", "TIMEOUT", {
      operation: "request.send",
      reason: "timeout",
      request: _request
    });
    if (delay > 0) {
      await wait(delay);
    }
    let req = this.clone();
    const scheme = (req.url.split(":")[0] || "").toLowerCase();
    if (scheme in Gateways) {
      const result2 = await Gateways[scheme](req.url, checkSignal(_request.#signal));
      if (result2 instanceof FetchResponse) {
        let response2 = result2;
        if (this.processFunc) {
          checkSignal(_request.#signal);
          try {
            response2 = await this.processFunc(req, response2);
          } catch (error) {
            if (error.throttle == null || typeof error.stall !== "number") {
              response2.makeServerError("error in post-processing function", error).assertOk();
            }
          }
        }
        return response2;
      }
      req = result2;
    }
    if (this.preflightFunc) {
      req = await this.preflightFunc(req);
    }
    const resp = await this.getUrlFunc(req, checkSignal(_request.#signal));
    let response = new FetchResponse(resp.statusCode, resp.statusMessage, resp.headers, resp.body, _request);
    if ([301, 302, 307, 308].indexOf(response.statusCode) >= 0) {
      try {
        const location = response.headers.location || "";
        return req.redirect(location).#send(attempt + 1, expires, 0, _request, response);
      } catch (error) {
      }
      return response;
    } else if (response.statusCode === 429) {
      if (this.retryFunc == null || await this.retryFunc(req, response, attempt)) {
        const retryAfter = response.headers["retry-after"];
        let delay2 = this.#throttle.slotInterval * Math.trunc(Math.random() * Math.pow(2, attempt));
        if (typeof retryAfter === "string" && retryAfter.match(/^[1-9][0-9]*$/)) {
          delay2 = parseInt(retryAfter);
        }
        return req.clone().#send(attempt + 1, expires, delay2, _request, response);
      }
    }
    if (this.processFunc) {
      checkSignal(_request.#signal);
      try {
        response = await this.processFunc(req, response);
      } catch (error) {
        if (error.throttle == null || typeof error.stall !== "number") {
          response.makeServerError("error in post-processing function", error).assertOk();
        }
        let delay2 = this.#throttle.slotInterval * Math.trunc(Math.random() * Math.pow(2, attempt));
        ;
        if (error.stall >= 0) {
          delay2 = error.stall;
        }
        return req.clone().#send(attempt + 1, expires, delay2, _request, response);
      }
    }
    return response;
  }
  /**
   *  Resolves to the response by sending the request.
   */
  send() {
    assert(this.#signal == null, "request already sent", "UNSUPPORTED_OPERATION", { operation: "fetchRequest.send" });
    this.#signal = new FetchCancelSignal(this);
    return this.#send(0, getTime() + this.timeout, 0, this, new FetchResponse(0, "", {}, null, this));
  }
  /**
   *  Cancels the inflight response, causing a ``CANCELLED``
   *  error to be rejected from the [[send]].
   */
  cancel() {
    assert(this.#signal != null, "request has not been sent", "UNSUPPORTED_OPERATION", { operation: "fetchRequest.cancel" });
    const signal = fetchSignals.get(this);
    if (!signal) {
      throw new Error("missing signal; should not happen");
    }
    signal();
  }
  /**
   *  Returns a new [[FetchRequest]] that represents the redirection
   *  to %%location%%.
   */
  redirect(location) {
    const current = this.url.split(":")[0].toLowerCase();
    const target = location.split(":")[0].toLowerCase();
    assert((current !== "https" || target !== "http") && location.match(/^https?:/), `unsupported redirect`, "UNSUPPORTED_OPERATION", {
      operation: `redirect(${this.method} ${JSON.stringify(this.url)} => ${JSON.stringify(location)})`
    });
    const req = new _FetchRequest(location);
    req.method = this.method;
    req.allowGzip = this.allowGzip;
    req.timeout = this.timeout;
    req.#headers = Object.assign({}, this.#headers);
    if (this.#body) {
      req.#body = new Uint8Array(this.#body);
    }
    req.#bodyType = this.#bodyType;
    return req;
  }
  /**
   *  Create a new copy of this request.
   */
  clone() {
    const clone = new _FetchRequest(this.url);
    clone.#method = this.#method;
    if (this.#body) {
      clone.#body = this.#body;
    }
    clone.#bodyType = this.#bodyType;
    clone.#headers = Object.assign({}, this.#headers);
    clone.#creds = this.#creds;
    if (this.allowGzip) {
      clone.allowGzip = true;
    }
    clone.timeout = this.timeout;
    if (this.allowInsecureAuthentication) {
      clone.allowInsecureAuthentication = true;
    }
    clone.#preflight = this.#preflight;
    clone.#process = this.#process;
    clone.#retry = this.#retry;
    clone.#throttle = Object.assign({}, this.#throttle);
    clone.#getUrlFunc = this.#getUrlFunc;
    return clone;
  }
  /**
   *  Locks all static configuration for gateways and FetchGetUrlFunc
   *  registration.
   */
  static lockConfig() {
    locked = true;
  }
  /**
   *  Get the current Gateway function for %%scheme%%.
   */
  static getGateway(scheme) {
    return Gateways[scheme.toLowerCase()] || null;
  }
  /**
   *  Use the %%func%% when fetching URIs using %%scheme%%.
   *
   *  This method affects all requests globally.
   *
   *  If [[lockConfig]] has been called, no change is made and this
   *  throws.
   */
  static registerGateway(scheme, func) {
    scheme = scheme.toLowerCase();
    if (scheme === "http" || scheme === "https") {
      throw new Error(`cannot intercept ${scheme}; use registerGetUrl`);
    }
    if (locked) {
      throw new Error("gateways locked");
    }
    Gateways[scheme] = func;
  }
  /**
   *  Use %%getUrl%% when fetching URIs over HTTP and HTTPS requests.
   *
   *  This method affects all requests globally.
   *
   *  If [[lockConfig]] has been called, no change is made and this
   *  throws.
   */
  static registerGetUrl(getUrl) {
    if (locked) {
      throw new Error("gateways locked");
    }
    defaultGetUrlFunc = getUrl;
  }
  /**
   *  Creates a getUrl function that fetches content from HTTP and
   *  HTTPS URLs.
   *
   *  The available %%options%% are dependent on the platform
   *  implementation of the default getUrl function.
   *
   *  This is not generally something that is needed, but is useful
   *  when trying to customize simple behaviour when fetching HTTP
   *  content.
   */
  static createGetUrlFunc(options2) {
    return createGetUrl(options2);
  }
  /**
   *  Creates a function that can "fetch" data URIs.
   *
   *  Note that this is automatically done internally to support
   *  data URIs, so it is not necessary to register it.
   *
   *  This is not generally something that is needed, but may
   *  be useful in a wrapper to perfom custom data URI functionality.
   */
  static createDataGateway() {
    return dataGatewayFunc;
  }
  /**
   *  Creates a function that will fetch IPFS (unvalidated) from
   *  a custom gateway baseUrl.
   *
   *  The default IPFS gateway used internally is
   *  ``"https:/\/gateway.ipfs.io/ipfs/"``.
   */
  static createIpfsGatewayFunc(baseUrl) {
    return getIpfsGatewayFunc(baseUrl);
  }
};
var FetchResponse = class _FetchResponse {
  #statusCode;
  #statusMessage;
  #headers;
  #body;
  #request;
  #error;
  toString() {
    return `<FetchResponse status=${this.statusCode} body=${this.#body ? hexlify(this.#body) : "null"}>`;
  }
  /**
   *  The response status code.
   */
  get statusCode() {
    return this.#statusCode;
  }
  /**
   *  The response status message.
   */
  get statusMessage() {
    return this.#statusMessage;
  }
  /**
   *  The response headers. All keys are lower-case.
   */
  get headers() {
    return Object.assign({}, this.#headers);
  }
  /**
   *  The response body, or ``null`` if there was no body.
   */
  get body() {
    return this.#body == null ? null : new Uint8Array(this.#body);
  }
  /**
   *  The response body as a UTF-8 encoded string, or the empty
   *  string (i.e. ``""``) if there was no body.
   *
   *  An error is thrown if the body is invalid UTF-8 data.
   */
  get bodyText() {
    try {
      return this.#body == null ? "" : toUtf8String(this.#body);
    } catch (error) {
      assert(false, "response body is not valid UTF-8 data", "UNSUPPORTED_OPERATION", {
        operation: "bodyText",
        info: { response: this }
      });
    }
  }
  /**
   *  The response body, decoded as JSON.
   *
   *  An error is thrown if the body is invalid JSON-encoded data
   *  or if there was no body.
   */
  get bodyJson() {
    try {
      return JSON.parse(this.bodyText);
    } catch (error) {
      assert(false, "response body is not valid JSON", "UNSUPPORTED_OPERATION", {
        operation: "bodyJson",
        info: { response: this }
      });
    }
  }
  [Symbol.iterator]() {
    const headers = this.headers;
    const keys = Object.keys(headers);
    let index = 0;
    return {
      next: () => {
        if (index < keys.length) {
          const key = keys[index++];
          return {
            value: [key, headers[key]],
            done: false
          };
        }
        return { value: void 0, done: true };
      }
    };
  }
  constructor(statusCode, statusMessage, headers, body, request) {
    this.#statusCode = statusCode;
    this.#statusMessage = statusMessage;
    this.#headers = Object.keys(headers).reduce((accum, k) => {
      accum[k.toLowerCase()] = String(headers[k]);
      return accum;
    }, {});
    this.#body = body == null ? null : new Uint8Array(body);
    this.#request = request || null;
    this.#error = { message: "" };
  }
  /**
   *  Return a Response with matching headers and body, but with
   *  an error status code (i.e. 599) and %%message%% with an
   *  optional %%error%%.
   */
  makeServerError(message, error) {
    let statusMessage;
    if (!message) {
      message = `${this.statusCode} ${this.statusMessage}`;
      statusMessage = `CLIENT ESCALATED SERVER ERROR (${message})`;
    } else {
      statusMessage = `CLIENT ESCALATED SERVER ERROR (${this.statusCode} ${this.statusMessage}; ${message})`;
    }
    const response = new _FetchResponse(599, statusMessage, this.headers, this.body, this.#request || void 0);
    response.#error = { message, error };
    return response;
  }
  /**
   *  If called within a [request.processFunc](FetchRequest-processFunc)
   *  call, causes the request to retry as if throttled for %%stall%%
   *  milliseconds.
   */
  throwThrottleError(message, stall5) {
    if (stall5 == null) {
      stall5 = -1;
    } else {
      assertArgument(Number.isInteger(stall5) && stall5 >= 0, "invalid stall timeout", "stall", stall5);
    }
    const error = new Error(message || "throttling requests");
    defineProperties(error, { stall: stall5, throttle: true });
    throw error;
  }
  /**
   *  Get the header value for %%key%%, ignoring case.
   */
  getHeader(key) {
    return this.headers[key.toLowerCase()];
  }
  /**
   *  Returns true if the response has a body.
   */
  hasBody() {
    return this.#body != null;
  }
  /**
   *  The request made for this response.
   */
  get request() {
    return this.#request;
  }
  /**
   *  Returns true if this response was a success statusCode.
   */
  ok() {
    return this.#error.message === "" && this.statusCode >= 200 && this.statusCode < 300;
  }
  /**
   *  Throws a ``SERVER_ERROR`` if this response is not ok.
   */
  assertOk() {
    if (this.ok()) {
      return;
    }
    let { message, error } = this.#error;
    if (message === "") {
      message = `server response ${this.statusCode} ${this.statusMessage}`;
    }
    let requestUrl = null;
    if (this.request) {
      requestUrl = this.request.url;
    }
    let responseBody = null;
    try {
      if (this.#body) {
        responseBody = toUtf8String(this.#body);
      }
    } catch (e) {
    }
    assert(false, message, "SERVER_ERROR", {
      request: this.request || "unknown request",
      response: this,
      error,
      info: {
        requestUrl,
        responseBody,
        responseStatus: `${this.statusCode} ${this.statusMessage}`
      }
    });
  }
};
function getTime() {
  return (/* @__PURE__ */ new Date()).getTime();
}
function unpercent(value) {
  return toUtf8Bytes(value.replace(/%([0-9a-f][0-9a-f])/gi, (all, code) => {
    return String.fromCharCode(parseInt(code, 16));
  }));
}
function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// node_modules/ethers/lib.esm/utils/fixednumber.js
var BN_N1 = BigInt(-1);
var BN_03 = BigInt(0);
var BN_12 = BigInt(1);
var BN_5 = BigInt(5);
var _guard = {};
var Zeros = "0000";
while (Zeros.length < 80) {
  Zeros += Zeros;
}
function getTens(decimals) {
  let result2 = Zeros;
  while (result2.length < decimals) {
    result2 += result2;
  }
  return BigInt("1" + result2.substring(0, decimals));
}
function checkValue(val, format, safeOp) {
  const width = BigInt(format.width);
  if (format.signed) {
    const limit = BN_12 << width - BN_12;
    assert(safeOp == null || val >= -limit && val < limit, "overflow", "NUMERIC_FAULT", {
      operation: safeOp,
      fault: "overflow",
      value: val
    });
    if (val > BN_03) {
      val = fromTwos(mask(val, width), width);
    } else {
      val = -fromTwos(mask(-val, width), width);
    }
  } else {
    const limit = BN_12 << width;
    assert(safeOp == null || val >= 0 && val < limit, "overflow", "NUMERIC_FAULT", {
      operation: safeOp,
      fault: "overflow",
      value: val
    });
    val = (val % limit + limit) % limit & limit - BN_12;
  }
  return val;
}
function getFormat(value) {
  if (typeof value === "number") {
    value = `fixed128x${value}`;
  }
  let signed2 = true;
  let width = 128;
  let decimals = 18;
  if (typeof value === "string") {
    if (value === "fixed") {
    } else if (value === "ufixed") {
      signed2 = false;
    } else {
      const match = value.match(/^(u?)fixed([0-9]+)x([0-9]+)$/);
      assertArgument(match, "invalid fixed format", "format", value);
      signed2 = match[1] !== "u";
      width = parseInt(match[2]);
      decimals = parseInt(match[3]);
    }
  } else if (value) {
    const v = value;
    const check = (key, type, defaultValue) => {
      if (v[key] == null) {
        return defaultValue;
      }
      assertArgument(typeof v[key] === type, "invalid fixed format (" + key + " not " + type + ")", "format." + key, v[key]);
      return v[key];
    };
    signed2 = check("signed", "boolean", signed2);
    width = check("width", "number", width);
    decimals = check("decimals", "number", decimals);
  }
  assertArgument(width % 8 === 0, "invalid FixedNumber width (not byte aligned)", "format.width", width);
  assertArgument(decimals <= 80, "invalid FixedNumber decimals (too large)", "format.decimals", decimals);
  const name = (signed2 ? "" : "u") + "fixed" + String(width) + "x" + String(decimals);
  return { signed: signed2, width, decimals, name };
}
function toString(val, decimals) {
  let negative = "";
  if (val < BN_03) {
    negative = "-";
    val *= BN_N1;
  }
  let str = val.toString();
  if (decimals === 0) {
    return negative + str;
  }
  while (str.length <= decimals) {
    str = Zeros + str;
  }
  const index = str.length - decimals;
  str = str.substring(0, index) + "." + str.substring(index);
  while (str[0] === "0" && str[1] !== ".") {
    str = str.substring(1);
  }
  while (str[str.length - 1] === "0" && str[str.length - 2] !== ".") {
    str = str.substring(0, str.length - 1);
  }
  return negative + str;
}
var FixedNumber = class _FixedNumber {
  /**
   *  The specific fixed-point arithmetic field for this value.
   */
  format;
  #format;
  // The actual value (accounting for decimals)
  #val;
  // A base-10 value to multiple values by to maintain the magnitude
  #tens;
  /**
   *  This is a property so console.log shows a human-meaningful value.
   *
   *  @private
   */
  _value;
  // Use this when changing this file to get some typing info,
  // but then switch to any to mask the internal type
  //constructor(guard: any, value: bigint, format: _FixedFormat) {
  /**
   *  @private
   */
  constructor(guard, value, format) {
    assertPrivate(guard, _guard, "FixedNumber");
    this.#val = value;
    this.#format = format;
    const _value = toString(value, format.decimals);
    defineProperties(this, { format: format.name, _value });
    this.#tens = getTens(format.decimals);
  }
  /**
   *  If true, negative values are permitted, otherwise only
   *  positive values and zero are allowed.
   */
  get signed() {
    return this.#format.signed;
  }
  /**
   *  The number of bits available to store the value.
   */
  get width() {
    return this.#format.width;
  }
  /**
   *  The number of decimal places in the fixed-point arithment field.
   */
  get decimals() {
    return this.#format.decimals;
  }
  /**
   *  The value as an integer, based on the smallest unit the
   *  [[decimals]] allow.
   */
  get value() {
    return this.#val;
  }
  #checkFormat(other) {
    assertArgument(this.format === other.format, "incompatible format; use fixedNumber.toFormat", "other", other);
  }
  #checkValue(val, safeOp) {
    val = checkValue(val, this.#format, safeOp);
    return new _FixedNumber(_guard, val, this.#format);
  }
  #add(o, safeOp) {
    this.#checkFormat(o);
    return this.#checkValue(this.#val + o.#val, safeOp);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% added
   *  to %%other%%, ignoring overflow.
   */
  addUnsafe(other) {
    return this.#add(other);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% added
   *  to %%other%%. A [[NumericFaultError]] is thrown if overflow
   *  occurs.
   */
  add(other) {
    return this.#add(other, "add");
  }
  #sub(o, safeOp) {
    this.#checkFormat(o);
    return this.#checkValue(this.#val - o.#val, safeOp);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%other%% subtracted
   *  from %%this%%, ignoring overflow.
   */
  subUnsafe(other) {
    return this.#sub(other);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%other%% subtracted
   *  from %%this%%. A [[NumericFaultError]] is thrown if overflow
   *  occurs.
   */
  sub(other) {
    return this.#sub(other, "sub");
  }
  #mul(o, safeOp) {
    this.#checkFormat(o);
    return this.#checkValue(this.#val * o.#val / this.#tens, safeOp);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% multiplied
   *  by %%other%%, ignoring overflow and underflow (precision loss).
   */
  mulUnsafe(other) {
    return this.#mul(other);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% multiplied
   *  by %%other%%. A [[NumericFaultError]] is thrown if overflow
   *  occurs.
   */
  mul(other) {
    return this.#mul(other, "mul");
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% multiplied
   *  by %%other%%. A [[NumericFaultError]] is thrown if overflow
   *  occurs or if underflow (precision loss) occurs.
   */
  mulSignal(other) {
    this.#checkFormat(other);
    const value = this.#val * other.#val;
    assert(value % this.#tens === BN_03, "precision lost during signalling mul", "NUMERIC_FAULT", {
      operation: "mulSignal",
      fault: "underflow",
      value: this
    });
    return this.#checkValue(value / this.#tens, "mulSignal");
  }
  #div(o, safeOp) {
    assert(o.#val !== BN_03, "division by zero", "NUMERIC_FAULT", {
      operation: "div",
      fault: "divide-by-zero",
      value: this
    });
    this.#checkFormat(o);
    return this.#checkValue(this.#val * this.#tens / o.#val, safeOp);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% divided
   *  by %%other%%, ignoring underflow (precision loss). A
   *  [[NumericFaultError]] is thrown if overflow occurs.
   */
  divUnsafe(other) {
    return this.#div(other);
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% divided
   *  by %%other%%, ignoring underflow (precision loss). A
   *  [[NumericFaultError]] is thrown if overflow occurs.
   */
  div(other) {
    return this.#div(other, "div");
  }
  /**
   *  Returns a new [[FixedNumber]] with the result of %%this%% divided
   *  by %%other%%. A [[NumericFaultError]] is thrown if underflow
   *  (precision loss) occurs.
   */
  divSignal(other) {
    assert(other.#val !== BN_03, "division by zero", "NUMERIC_FAULT", {
      operation: "div",
      fault: "divide-by-zero",
      value: this
    });
    this.#checkFormat(other);
    const value = this.#val * this.#tens;
    assert(value % other.#val === BN_03, "precision lost during signalling div", "NUMERIC_FAULT", {
      operation: "divSignal",
      fault: "underflow",
      value: this
    });
    return this.#checkValue(value / other.#val, "divSignal");
  }
  /**
   *  Returns a comparison result between %%this%% and %%other%%.
   *
   *  This is suitable for use in sorting, where ``-1`` implies %%this%%
   *  is smaller, ``1`` implies %%this%% is larger and ``0`` implies
   *  both are equal.
   */
  cmp(other) {
    let a = this.value, b2 = other.value;
    const delta = this.decimals - other.decimals;
    if (delta > 0) {
      b2 *= getTens(delta);
    } else if (delta < 0) {
      a *= getTens(-delta);
    }
    if (a < b2) {
      return -1;
    }
    if (a > b2) {
      return 1;
    }
    return 0;
  }
  /**
   *  Returns true if %%other%% is equal to %%this%%.
   */
  eq(other) {
    return this.cmp(other) === 0;
  }
  /**
   *  Returns true if %%other%% is less than to %%this%%.
   */
  lt(other) {
    return this.cmp(other) < 0;
  }
  /**
   *  Returns true if %%other%% is less than or equal to %%this%%.
   */
  lte(other) {
    return this.cmp(other) <= 0;
  }
  /**
   *  Returns true if %%other%% is greater than to %%this%%.
   */
  gt(other) {
    return this.cmp(other) > 0;
  }
  /**
   *  Returns true if %%other%% is greater than or equal to %%this%%.
   */
  gte(other) {
    return this.cmp(other) >= 0;
  }
  /**
   *  Returns a new [[FixedNumber]] which is the largest **integer**
   *  that is less than or equal to %%this%%.
   *
   *  The decimal component of the result will always be ``0``.
   */
  floor() {
    let val = this.#val;
    if (this.#val < BN_03) {
      val -= this.#tens - BN_12;
    }
    val = this.#val / this.#tens * this.#tens;
    return this.#checkValue(val, "floor");
  }
  /**
   *  Returns a new [[FixedNumber]] which is the smallest **integer**
   *  that is greater than or equal to %%this%%.
   *
   *  The decimal component of the result will always be ``0``.
   */
  ceiling() {
    let val = this.#val;
    if (this.#val > BN_03) {
      val += this.#tens - BN_12;
    }
    val = this.#val / this.#tens * this.#tens;
    return this.#checkValue(val, "ceiling");
  }
  /**
   *  Returns a new [[FixedNumber]] with the decimal component
   *  rounded up on ties at %%decimals%% places.
   */
  round(decimals) {
    if (decimals == null) {
      decimals = 0;
    }
    if (decimals >= this.decimals) {
      return this;
    }
    const delta = this.decimals - decimals;
    const bump = BN_5 * getTens(delta - 1);
    let value = this.value + bump;
    const tens = getTens(delta);
    value = value / tens * tens;
    checkValue(value, this.#format, "round");
    return new _FixedNumber(_guard, value, this.#format);
  }
  /**
   *  Returns true if %%this%% is equal to ``0``.
   */
  isZero() {
    return this.#val === BN_03;
  }
  /**
   *  Returns true if %%this%% is less than ``0``.
   */
  isNegative() {
    return this.#val < BN_03;
  }
  /**
   *  Returns the string representation of %%this%%.
   */
  toString() {
    return this._value;
  }
  /**
   *  Returns a float approximation.
   *
   *  Due to IEEE 754 precission (or lack thereof), this function
   *  can only return an approximation and most values will contain
   *  rounding errors.
   */
  toUnsafeFloat() {
    return parseFloat(this.toString());
  }
  /**
   *  Return a new [[FixedNumber]] with the same value but has had
   *  its field set to %%format%%.
   *
   *  This will throw if the value cannot fit into %%format%%.
   */
  toFormat(format) {
    return _FixedNumber.fromString(this.toString(), format);
  }
  /**
   *  Creates a new [[FixedNumber]] for %%value%% divided by
   *  %%decimal%% places with %%format%%.
   *
   *  This will throw a [[NumericFaultError]] if %%value%% (once adjusted
   *  for %%decimals%%) cannot fit in %%format%%, either due to overflow
   *  or underflow (precision loss).
   */
  static fromValue(_value, _decimals, _format) {
    const decimals = _decimals == null ? 0 : getNumber(_decimals);
    const format = getFormat(_format);
    let value = getBigInt(_value, "value");
    const delta = decimals - format.decimals;
    if (delta > 0) {
      const tens = getTens(delta);
      assert(value % tens === BN_03, "value loses precision for format", "NUMERIC_FAULT", {
        operation: "fromValue",
        fault: "underflow",
        value: _value
      });
      value /= tens;
    } else if (delta < 0) {
      value *= getTens(-delta);
    }
    checkValue(value, format, "fromValue");
    return new _FixedNumber(_guard, value, format);
  }
  /**
   *  Creates a new [[FixedNumber]] for %%value%% with %%format%%.
   *
   *  This will throw a [[NumericFaultError]] if %%value%% cannot fit
   *  in %%format%%, either due to overflow or underflow (precision loss).
   */
  static fromString(_value, _format) {
    const match = _value.match(/^(-?)([0-9]*)\.?([0-9]*)$/);
    assertArgument(match && match[2].length + match[3].length > 0, "invalid FixedNumber string value", "value", _value);
    const format = getFormat(_format);
    let whole = match[2] || "0", decimal = match[3] || "";
    while (decimal.length < format.decimals) {
      decimal += Zeros;
    }
    assert(decimal.substring(format.decimals).match(/^0*$/), "too many decimals for format", "NUMERIC_FAULT", {
      operation: "fromString",
      fault: "underflow",
      value: _value
    });
    decimal = decimal.substring(0, format.decimals);
    const value = BigInt(match[1] + whole + decimal);
    checkValue(value, format, "fromString");
    return new _FixedNumber(_guard, value, format);
  }
  /**
   *  Creates a new [[FixedNumber]] with the big-endian representation
   *  %%value%% with %%format%%.
   *
   *  This will throw a [[NumericFaultError]] if %%value%% cannot fit
   *  in %%format%% due to overflow.
   */
  static fromBytes(_value, _format) {
    let value = toBigInt(getBytes(_value, "value"));
    const format = getFormat(_format);
    if (format.signed) {
      value = fromTwos(value, format.width);
    }
    checkValue(value, format, "fromBytes");
    return new _FixedNumber(_guard, value, format);
  }
};

// node_modules/ethers/lib.esm/utils/rlp-decode.js
function hexlifyByte(value) {
  let result2 = value.toString(16);
  while (result2.length < 2) {
    result2 = "0" + result2;
  }
  return "0x" + result2;
}
function unarrayifyInteger(data, offset, length) {
  let result2 = 0;
  for (let i = 0; i < length; i++) {
    result2 = result2 * 256 + data[offset + i];
  }
  return result2;
}
function _decodeChildren(data, offset, childOffset, length) {
  const result2 = [];
  while (childOffset < offset + 1 + length) {
    const decoded = _decode(data, childOffset);
    result2.push(decoded.result);
    childOffset += decoded.consumed;
    assert(childOffset <= offset + 1 + length, "child data too short", "BUFFER_OVERRUN", {
      buffer: data,
      length,
      offset
    });
  }
  return { consumed: 1 + length, result: result2 };
}
function _decode(data, offset) {
  assert(data.length !== 0, "data too short", "BUFFER_OVERRUN", {
    buffer: data,
    length: 0,
    offset: 1
  });
  const checkOffset = (offset2) => {
    assert(offset2 <= data.length, "data short segment too short", "BUFFER_OVERRUN", {
      buffer: data,
      length: data.length,
      offset: offset2
    });
  };
  if (data[offset] >= 248) {
    const lengthLength = data[offset] - 247;
    checkOffset(offset + 1 + lengthLength);
    const length = unarrayifyInteger(data, offset + 1, lengthLength);
    checkOffset(offset + 1 + lengthLength + length);
    return _decodeChildren(data, offset, offset + 1 + lengthLength, lengthLength + length);
  } else if (data[offset] >= 192) {
    const length = data[offset] - 192;
    checkOffset(offset + 1 + length);
    return _decodeChildren(data, offset, offset + 1, length);
  } else if (data[offset] >= 184) {
    const lengthLength = data[offset] - 183;
    checkOffset(offset + 1 + lengthLength);
    const length = unarrayifyInteger(data, offset + 1, lengthLength);
    checkOffset(offset + 1 + lengthLength + length);
    const result2 = hexlify(data.slice(offset + 1 + lengthLength, offset + 1 + lengthLength + length));
    return { consumed: 1 + lengthLength + length, result: result2 };
  } else if (data[offset] >= 128) {
    const length = data[offset] - 128;
    checkOffset(offset + 1 + length);
    const result2 = hexlify(data.slice(offset + 1, offset + 1 + length));
    return { consumed: 1 + length, result: result2 };
  }
  return { consumed: 1, result: hexlifyByte(data[offset]) };
}
function decodeRlp(_data) {
  const data = getBytes(_data, "data");
  const decoded = _decode(data, 0);
  assertArgument(decoded.consumed === data.length, "unexpected junk after rlp payload", "data", _data);
  return decoded.result;
}

// node_modules/ethers/lib.esm/utils/rlp-encode.js
function arrayifyInteger(value) {
  const result2 = [];
  while (value) {
    result2.unshift(value & 255);
    value >>= 8;
  }
  return result2;
}
function _encode(object2) {
  if (Array.isArray(object2)) {
    let payload = [];
    object2.forEach(function(child) {
      payload = payload.concat(_encode(child));
    });
    if (payload.length <= 55) {
      payload.unshift(192 + payload.length);
      return payload;
    }
    const length2 = arrayifyInteger(payload.length);
    length2.unshift(247 + length2.length);
    return length2.concat(payload);
  }
  const data = Array.prototype.slice.call(getBytes(object2, "object"));
  if (data.length === 1 && data[0] <= 127) {
    return data;
  } else if (data.length <= 55) {
    data.unshift(128 + data.length);
    return data;
  }
  const length = arrayifyInteger(data.length);
  length.unshift(183 + length.length);
  return length.concat(data);
}
var nibbles = "0123456789abcdef";
function encodeRlp(object2) {
  let result2 = "0x";
  for (const v of _encode(object2)) {
    result2 += nibbles[v >> 4];
    result2 += nibbles[v & 15];
  }
  return result2;
}

// node_modules/ethers/lib.esm/utils/units.js
var names = [
  "wei",
  "kwei",
  "mwei",
  "gwei",
  "szabo",
  "finney",
  "ether"
];
function formatUnits(value, unit) {
  let decimals = 18;
  if (typeof unit === "string") {
    const index = names.indexOf(unit);
    assertArgument(index >= 0, "invalid unit", "unit", unit);
    decimals = 3 * index;
  } else if (unit != null) {
    decimals = getNumber(unit, "unit");
  }
  return FixedNumber.fromValue(value, decimals, { decimals, width: 512 }).toString();
}
function parseUnits(value, unit) {
  assertArgument(typeof value === "string", "value must be a string", "value", value);
  let decimals = 18;
  if (typeof unit === "string") {
    const index = names.indexOf(unit);
    assertArgument(index >= 0, "invalid unit", "unit", unit);
    decimals = 3 * index;
  } else if (unit != null) {
    decimals = getNumber(unit, "unit");
  }
  return FixedNumber.fromString(value, { decimals, width: 512 }).value;
}
function formatEther(wei) {
  return formatUnits(wei, 18);
}

// node_modules/ethers/lib.esm/utils/uuid.js
function uuidV4(randomBytes5) {
  const bytes2 = getBytes(randomBytes5, "randomBytes");
  bytes2[6] = bytes2[6] & 15 | 64;
  bytes2[8] = bytes2[8] & 63 | 128;
  const value = hexlify(bytes2);
  return [
    value.substring(2, 10),
    value.substring(10, 14),
    value.substring(14, 18),
    value.substring(18, 22),
    value.substring(22, 34)
  ].join("-");
}

// node_modules/ethers/lib.esm/abi/coders/abstract-coder.js
var WordSize = 32;
var Padding = new Uint8Array(WordSize);
var passProperties = ["then"];
var _guard2 = {};
var resultNames = /* @__PURE__ */ new WeakMap();
function getNames(result2) {
  return resultNames.get(result2);
}
function setNames(result2, names2) {
  resultNames.set(result2, names2);
}
function throwError(name, error) {
  const wrapped = new Error(`deferred error during ABI decoding triggered accessing ${name}`);
  wrapped.error = error;
  throw wrapped;
}
function toObject(names2, items, deep) {
  if (names2.indexOf(null) >= 0) {
    return items.map((item, index) => {
      if (item instanceof Result) {
        return toObject(getNames(item), item, deep);
      }
      return item;
    });
  }
  return names2.reduce((accum, name, index) => {
    let item = items.getValue(name);
    if (!(name in accum)) {
      if (deep && item instanceof Result) {
        item = toObject(getNames(item), item, deep);
      }
      accum[name] = item;
    }
    return accum;
  }, {});
}
var Result = class _Result extends Array {
  // No longer used; but cannot be removed as it will remove the
  // #private field from the .d.ts which may break backwards
  // compatibility
  #names;
  /**
   *  @private
   */
  constructor(...args) {
    const guard = args[0];
    let items = args[1];
    let names2 = (args[2] || []).slice();
    let wrap = true;
    if (guard !== _guard2) {
      items = args;
      names2 = [];
      wrap = false;
    }
    super(items.length);
    items.forEach((item, index) => {
      this[index] = item;
    });
    const nameCounts = names2.reduce((accum, name) => {
      if (typeof name === "string") {
        accum.set(name, (accum.get(name) || 0) + 1);
      }
      return accum;
    }, /* @__PURE__ */ new Map());
    setNames(this, Object.freeze(items.map((item, index) => {
      const name = names2[index];
      if (name != null && nameCounts.get(name) === 1) {
        return name;
      }
      return null;
    })));
    this.#names = [];
    if (this.#names == null) {
      void this.#names;
    }
    if (!wrap) {
      return;
    }
    Object.freeze(this);
    const proxy = new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === "string") {
          if (prop.match(/^[0-9]+$/)) {
            const index = getNumber(prop, "%index");
            if (index < 0 || index >= this.length) {
              throw new RangeError("out of result range");
            }
            const item = target[index];
            if (item instanceof Error) {
              throwError(`index ${index}`, item);
            }
            return item;
          }
          if (passProperties.indexOf(prop) >= 0) {
            return Reflect.get(target, prop, receiver);
          }
          const value = target[prop];
          if (value instanceof Function) {
            return function(...args2) {
              return value.apply(this === receiver ? target : this, args2);
            };
          } else if (!(prop in target)) {
            return target.getValue.apply(this === receiver ? target : this, [prop]);
          }
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    setNames(proxy, getNames(this));
    return proxy;
  }
  /**
   *  Returns the Result as a normal Array. If %%deep%%, any children
   *  which are Result objects are also converted to a normal Array.
   *
   *  This will throw if there are any outstanding deferred
   *  errors.
   */
  toArray(deep) {
    const result2 = [];
    this.forEach((item, index) => {
      if (item instanceof Error) {
        throwError(`index ${index}`, item);
      }
      if (deep && item instanceof _Result) {
        item = item.toArray(deep);
      }
      result2.push(item);
    });
    return result2;
  }
  /**
   *  Returns the Result as an Object with each name-value pair. If
   *  %%deep%%, any children which are Result objects are also
   *  converted to an Object.
   *
   *  This will throw if any value is unnamed, or if there are
   *  any outstanding deferred errors.
   */
  toObject(deep) {
    const names2 = getNames(this);
    return names2.reduce((accum, name, index) => {
      assert(name != null, `value at index ${index} unnamed`, "UNSUPPORTED_OPERATION", {
        operation: "toObject()"
      });
      return toObject(names2, this, deep);
    }, {});
  }
  /**
   *  @_ignore
   */
  slice(start, end) {
    if (start == null) {
      start = 0;
    }
    if (start < 0) {
      start += this.length;
      if (start < 0) {
        start = 0;
      }
    }
    if (end == null) {
      end = this.length;
    }
    if (end < 0) {
      end += this.length;
      if (end < 0) {
        end = 0;
      }
    }
    if (end > this.length) {
      end = this.length;
    }
    const _names = getNames(this);
    const result2 = [], names2 = [];
    for (let i = start; i < end; i++) {
      result2.push(this[i]);
      names2.push(_names[i]);
    }
    return new _Result(_guard2, result2, names2);
  }
  /**
   *  @_ignore
   */
  filter(callback, thisArg) {
    const _names = getNames(this);
    const result2 = [], names2 = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      if (item instanceof Error) {
        throwError(`index ${i}`, item);
      }
      if (callback.call(thisArg, item, i, this)) {
        result2.push(item);
        names2.push(_names[i]);
      }
    }
    return new _Result(_guard2, result2, names2);
  }
  /**
   *  @_ignore
   */
  map(callback, thisArg) {
    const result2 = [];
    for (let i = 0; i < this.length; i++) {
      const item = this[i];
      if (item instanceof Error) {
        throwError(`index ${i}`, item);
      }
      result2.push(callback.call(thisArg, item, i, this));
    }
    return result2;
  }
  /**
   *  Returns the value for %%name%%.
   *
   *  Since it is possible to have a key whose name conflicts with
   *  a method on a [[Result]] or its superclass Array, or any
   *  JavaScript keyword, this ensures all named values are still
   *  accessible by name.
   */
  getValue(name) {
    const index = getNames(this).indexOf(name);
    if (index === -1) {
      return void 0;
    }
    const value = this[index];
    if (value instanceof Error) {
      throwError(`property ${JSON.stringify(name)}`, value.error);
    }
    return value;
  }
  /**
   *  Creates a new [[Result]] for %%items%% with each entry
   *  also accessible by its corresponding name in %%keys%%.
   */
  static fromItems(items, keys) {
    return new _Result(_guard2, items, keys);
  }
};
function getValue(value) {
  let bytes2 = toBeArray(value);
  assert(bytes2.length <= WordSize, "value out-of-bounds", "BUFFER_OVERRUN", { buffer: bytes2, length: WordSize, offset: bytes2.length });
  if (bytes2.length !== WordSize) {
    bytes2 = getBytesCopy(concat([Padding.slice(bytes2.length % WordSize), bytes2]));
  }
  return bytes2;
}
var Coder = class {
  // The coder name:
  //   - address, uint256, tuple, array, etc.
  name;
  // The fully expanded type, including composite types:
  //   - address, uint256, tuple(address,bytes), uint256[3][4][],  etc.
  type;
  // The localName bound in the signature, in this example it is "baz":
  //   - tuple(address foo, uint bar) baz
  localName;
  // Whether this type is dynamic:
  //  - Dynamic: bytes, string, address[], tuple(boolean[]), etc.
  //  - Not Dynamic: address, uint256, boolean[3], tuple(address, uint8)
  dynamic;
  constructor(name, type, localName, dynamic) {
    defineProperties(this, { name, type, localName, dynamic }, {
      name: "string",
      type: "string",
      localName: "string",
      dynamic: "boolean"
    });
  }
  _throwError(message, value) {
    assertArgument(false, message, this.localName, value);
  }
};
var Writer = class {
  // An array of WordSize lengthed objects to concatenation
  #data;
  #dataLength;
  constructor() {
    this.#data = [];
    this.#dataLength = 0;
  }
  get data() {
    return concat(this.#data);
  }
  get length() {
    return this.#dataLength;
  }
  #writeData(data) {
    this.#data.push(data);
    this.#dataLength += data.length;
    return data.length;
  }
  appendWriter(writer) {
    return this.#writeData(getBytesCopy(writer.data));
  }
  // Arrayish item; pad on the right to *nearest* WordSize
  writeBytes(value) {
    let bytes2 = getBytesCopy(value);
    const paddingOffset = bytes2.length % WordSize;
    if (paddingOffset) {
      bytes2 = getBytesCopy(concat([bytes2, Padding.slice(paddingOffset)]));
    }
    return this.#writeData(bytes2);
  }
  // Numeric item; pad on the left *to* WordSize
  writeValue(value) {
    return this.#writeData(getValue(value));
  }
  // Inserts a numeric place-holder, returning a callback that can
  // be used to asjust the value later
  writeUpdatableValue() {
    const offset = this.#data.length;
    this.#data.push(Padding);
    this.#dataLength += WordSize;
    return (value) => {
      this.#data[offset] = getValue(value);
    };
  }
};
var Reader = class _Reader {
  // Allows incomplete unpadded data to be read; otherwise an error
  // is raised if attempting to overrun the buffer. This is required
  // to deal with an old Solidity bug, in which event data for
  // external (not public thoguh) was tightly packed.
  allowLoose;
  #data;
  #offset;
  #bytesRead;
  #parent;
  #maxInflation;
  constructor(data, allowLoose, maxInflation) {
    defineProperties(this, { allowLoose: !!allowLoose });
    this.#data = getBytesCopy(data);
    this.#bytesRead = 0;
    this.#parent = null;
    this.#maxInflation = maxInflation != null ? maxInflation : 1024;
    this.#offset = 0;
  }
  get data() {
    return hexlify(this.#data);
  }
  get dataLength() {
    return this.#data.length;
  }
  get consumed() {
    return this.#offset;
  }
  get bytes() {
    return new Uint8Array(this.#data);
  }
  #incrementBytesRead(count) {
    if (this.#parent) {
      return this.#parent.#incrementBytesRead(count);
    }
    this.#bytesRead += count;
    assert(this.#maxInflation < 1 || this.#bytesRead <= this.#maxInflation * this.dataLength, `compressed ABI data exceeds inflation ratio of ${this.#maxInflation} ( see: https://github.com/ethers-io/ethers.js/issues/4537 )`, "BUFFER_OVERRUN", {
      buffer: getBytesCopy(this.#data),
      offset: this.#offset,
      length: count,
      info: {
        bytesRead: this.#bytesRead,
        dataLength: this.dataLength
      }
    });
  }
  #peekBytes(offset, length, loose) {
    let alignedLength = Math.ceil(length / WordSize) * WordSize;
    if (this.#offset + alignedLength > this.#data.length) {
      if (this.allowLoose && loose && this.#offset + length <= this.#data.length) {
        alignedLength = length;
      } else {
        assert(false, "data out-of-bounds", "BUFFER_OVERRUN", {
          buffer: getBytesCopy(this.#data),
          length: this.#data.length,
          offset: this.#offset + alignedLength
        });
      }
    }
    return this.#data.slice(this.#offset, this.#offset + alignedLength);
  }
  // Create a sub-reader with the same underlying data, but offset
  subReader(offset) {
    const reader = new _Reader(this.#data.slice(this.#offset + offset), this.allowLoose, this.#maxInflation);
    reader.#parent = this;
    return reader;
  }
  // Read bytes
  readBytes(length, loose) {
    let bytes2 = this.#peekBytes(0, length, !!loose);
    this.#incrementBytesRead(length);
    this.#offset += bytes2.length;
    return bytes2.slice(0, length);
  }
  // Read a numeric values
  readValue() {
    return toBigInt(this.readBytes(WordSize));
  }
  readIndex() {
    return toNumber(this.readBytes(WordSize));
  }
};

// node_modules/ethers/lib.esm/crypto/crypto.js
var import_crypto = require("crypto");

// node_modules/ethers/lib.esm/crypto/hmac.js
var locked2 = false;
var _computeHmac = function(algorithm, key, data) {
  return (0, import_crypto.createHmac)(algorithm, key).update(data).digest();
};
var __computeHmac = _computeHmac;
function computeHmac(algorithm, _key, _data) {
  const key = getBytes(_key, "key");
  const data = getBytes(_data, "data");
  return hexlify(__computeHmac(algorithm, key, data));
}
computeHmac._ = _computeHmac;
computeHmac.lock = function() {
  locked2 = true;
};
computeHmac.register = function(func) {
  if (locked2) {
    throw new Error("computeHmac is locked");
  }
  __computeHmac = func;
};
Object.freeze(computeHmac);

// node_modules/@noble/hashes/esm/_assert.js
function number(n2) {
  if (!Number.isSafeInteger(n2) || n2 < 0)
    throw new Error(`Wrong positive integer: ${n2}`);
}
function bytes(b2, ...lengths) {
  if (!(b2 instanceof Uint8Array))
    throw new Error("Expected Uint8Array");
  if (lengths.length > 0 && !lengths.includes(b2.length))
    throw new Error(`Expected Uint8Array of length ${lengths}, not of length=${b2.length}`);
}
function hash(hash2) {
  if (typeof hash2 !== "function" || typeof hash2.create !== "function")
    throw new Error("Hash should be wrapped by utils.wrapConstructor");
  number(hash2.outputLen);
  number(hash2.blockLen);
}
function exists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function output(out, instance) {
  bytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error(`digestInto() expects output buffer of length at least ${min}`);
  }
}

// node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n2, le = false) {
  if (le)
    return { h: Number(n2 & U32_MASK64), l: Number(n2 >> _32n & U32_MASK64) };
  return { h: Number(n2 >> _32n & U32_MASK64) | 0, l: Number(n2 & U32_MASK64) | 0 };
}
function split(lst, le = false) {
  let Ah = new Uint32Array(lst.length);
  let Al = new Uint32Array(lst.length);
  for (let i = 0; i < lst.length; i++) {
    const { h, l } = fromBig(lst[i], le);
    [Ah[i], Al[i]] = [h, l];
  }
  return [Ah, Al];
}
var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

// node_modules/@noble/hashes/esm/cryptoNode.js
var nc = __toESM(require("node:crypto"), 1);
var crypto = nc && typeof nc === "object" && "webcrypto" in nc ? nc.webcrypto : void 0;

// node_modules/@noble/hashes/esm/utils.js
var u8a = (a) => a instanceof Uint8Array;
var u32 = (arr) => new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
var createView = (arr) => new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
var rotr = (word, shift) => word << 32 - shift | word >>> shift;
var isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
if (!isLE)
  throw new Error("Non little-endian hardware is not supported");
var nextTick = async () => {
};
async function asyncLoop(iters, tick, cb) {
  let ts = Date.now();
  for (let i = 0; i < iters; i++) {
    cb(i);
    const diff = Date.now() - ts;
    if (diff >= 0 && diff < tick)
      continue;
    await nextTick();
    ts += diff;
  }
}
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error(`utf8ToBytes expected string, got ${typeof str}`);
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  if (!u8a(data))
    throw new Error(`expected Uint8Array, got ${typeof data}`);
  return data;
}
function concatBytes(...arrays) {
  const r = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0));
  let pad = 0;
  arrays.forEach((a) => {
    if (!u8a(a))
      throw new Error("Uint8Array expected");
    r.set(a, pad);
    pad += a.length;
  });
  return r;
}
var Hash = class {
  // Safe version that clones internal state
  clone() {
    return this._cloneInto();
  }
};
var toStr = {}.toString;
function checkOpts(defaults, opts) {
  if (opts !== void 0 && toStr.call(opts) !== "[object Object]")
    throw new Error("Options should be object or undefined");
  const merged = Object.assign(defaults, opts);
  return merged;
}
function wrapConstructor(hashCons) {
  const hashC = (msg) => hashCons().update(toBytes(msg)).digest();
  const tmp = hashCons();
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = () => hashCons();
  return hashC;
}
function wrapXOFConstructorWithOpts(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}
function randomBytes2(bytesLength = 32) {
  if (crypto && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint8Array(bytesLength));
  }
  throw new Error("crypto.getRandomValues must be defined");
}

// node_modules/@noble/hashes/esm/sha3.js
var [SHA3_PI, SHA3_ROTL, _SHA3_IOTA] = [[], [], []];
var _0n = /* @__PURE__ */ BigInt(0);
var _1n = /* @__PURE__ */ BigInt(1);
var _2n = /* @__PURE__ */ BigInt(2);
var _7n = /* @__PURE__ */ BigInt(7);
var _256n = /* @__PURE__ */ BigInt(256);
var _0x71n = /* @__PURE__ */ BigInt(113);
for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  SHA3_PI.push(2 * (5 * y + x));
  SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
  let t = _0n;
  for (let j = 0; j < 7; j++) {
    R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
    if (R & _2n)
      t ^= _1n << (_1n << /* @__PURE__ */ BigInt(j)) - _1n;
  }
  _SHA3_IOTA.push(t);
}
var [SHA3_IOTA_H, SHA3_IOTA_L] = /* @__PURE__ */ split(_SHA3_IOTA, true);
var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
function keccakP(s, rounds = 24) {
  const B = new Uint32Array(5 * 2);
  for (let round = 24 - rounds; round < 24; round++) {
    for (let x = 0; x < 10; x++)
      B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
    for (let x = 0; x < 10; x += 2) {
      const idx1 = (x + 8) % 10;
      const idx0 = (x + 2) % 10;
      const B0 = B[idx0];
      const B1 = B[idx0 + 1];
      const Th = rotlH(B0, B1, 1) ^ B[idx1];
      const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
      for (let y = 0; y < 50; y += 10) {
        s[x + y] ^= Th;
        s[x + y + 1] ^= Tl;
      }
    }
    let curH = s[2];
    let curL = s[3];
    for (let t = 0; t < 24; t++) {
      const shift = SHA3_ROTL[t];
      const Th = rotlH(curH, curL, shift);
      const Tl = rotlL(curH, curL, shift);
      const PI = SHA3_PI[t];
      curH = s[PI];
      curL = s[PI + 1];
      s[PI] = Th;
      s[PI + 1] = Tl;
    }
    for (let y = 0; y < 50; y += 10) {
      for (let x = 0; x < 10; x++)
        B[x] = s[y + x];
      for (let x = 0; x < 10; x++)
        s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
    }
    s[0] ^= SHA3_IOTA_H[round];
    s[1] ^= SHA3_IOTA_L[round];
  }
  B.fill(0);
}
var Keccak = class _Keccak extends Hash {
  // NOTE: we accept arguments in bytes instead of bits here.
  constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
    super();
    this.blockLen = blockLen;
    this.suffix = suffix;
    this.outputLen = outputLen;
    this.enableXOF = enableXOF;
    this.rounds = rounds;
    this.pos = 0;
    this.posOut = 0;
    this.finished = false;
    this.destroyed = false;
    number(outputLen);
    if (0 >= this.blockLen || this.blockLen >= 200)
      throw new Error("Sha3 supports only keccak-f1600 function");
    this.state = new Uint8Array(200);
    this.state32 = u32(this.state);
  }
  keccak() {
    keccakP(this.state32, this.rounds);
    this.posOut = 0;
    this.pos = 0;
  }
  update(data) {
    exists(this);
    const { blockLen, state } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      for (let i = 0; i < take; i++)
        state[this.pos++] ^= data[pos++];
      if (this.pos === blockLen)
        this.keccak();
    }
    return this;
  }
  finish() {
    if (this.finished)
      return;
    this.finished = true;
    const { state, suffix, pos, blockLen } = this;
    state[pos] ^= suffix;
    if ((suffix & 128) !== 0 && pos === blockLen - 1)
      this.keccak();
    state[blockLen - 1] ^= 128;
    this.keccak();
  }
  writeInto(out) {
    exists(this, false);
    bytes(out);
    this.finish();
    const bufferOut = this.state;
    const { blockLen } = this;
    for (let pos = 0, len = out.length; pos < len; ) {
      if (this.posOut >= blockLen)
        this.keccak();
      const take = Math.min(blockLen - this.posOut, len - pos);
      out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
      this.posOut += take;
      pos += take;
    }
    return out;
  }
  xofInto(out) {
    if (!this.enableXOF)
      throw new Error("XOF is not possible for this instance");
    return this.writeInto(out);
  }
  xof(bytes2) {
    number(bytes2);
    return this.xofInto(new Uint8Array(bytes2));
  }
  digestInto(out) {
    output(out, this);
    if (this.finished)
      throw new Error("digest() was already called");
    this.writeInto(out);
    this.destroy();
    return out;
  }
  digest() {
    return this.digestInto(new Uint8Array(this.outputLen));
  }
  destroy() {
    this.destroyed = true;
    this.state.fill(0);
  }
  _cloneInto(to) {
    const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
    to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
    to.state32.set(this.state32);
    to.pos = this.pos;
    to.posOut = this.posOut;
    to.finished = this.finished;
    to.rounds = rounds;
    to.suffix = suffix;
    to.outputLen = outputLen;
    to.enableXOF = enableXOF;
    to.destroyed = this.destroyed;
    return to;
  }
};
var gen = (suffix, blockLen, outputLen) => wrapConstructor(() => new Keccak(blockLen, suffix, outputLen));
var sha3_224 = /* @__PURE__ */ gen(6, 144, 224 / 8);
var sha3_256 = /* @__PURE__ */ gen(6, 136, 256 / 8);
var sha3_384 = /* @__PURE__ */ gen(6, 104, 384 / 8);
var sha3_512 = /* @__PURE__ */ gen(6, 72, 512 / 8);
var keccak_224 = /* @__PURE__ */ gen(1, 144, 224 / 8);
var keccak_256 = /* @__PURE__ */ gen(1, 136, 256 / 8);
var keccak_384 = /* @__PURE__ */ gen(1, 104, 384 / 8);
var keccak_512 = /* @__PURE__ */ gen(1, 72, 512 / 8);
var genShake = (suffix, blockLen, outputLen) => wrapXOFConstructorWithOpts((opts = {}) => new Keccak(blockLen, suffix, opts.dkLen === void 0 ? outputLen : opts.dkLen, true));
var shake128 = /* @__PURE__ */ genShake(31, 168, 128 / 8);
var shake256 = /* @__PURE__ */ genShake(31, 136, 256 / 8);

// node_modules/ethers/lib.esm/crypto/keccak.js
var locked3 = false;
var _keccak256 = function(data) {
  return keccak_256(data);
};
var __keccak256 = _keccak256;
function keccak256(_data) {
  const data = getBytes(_data, "data");
  return hexlify(__keccak256(data));
}
keccak256._ = _keccak256;
keccak256.lock = function() {
  locked3 = true;
};
keccak256.register = function(func) {
  if (locked3) {
    throw new TypeError("keccak256 is locked");
  }
  __keccak256 = func;
};
Object.freeze(keccak256);

// node_modules/@noble/hashes/esm/_sha2.js
function setBigUint64(view, byteOffset, value, isLE2) {
  if (typeof view.setBigUint64 === "function")
    return view.setBigUint64(byteOffset, value, isLE2);
  const _32n2 = BigInt(32);
  const _u32_max = BigInt(4294967295);
  const wh = Number(value >> _32n2 & _u32_max);
  const wl = Number(value & _u32_max);
  const h = isLE2 ? 4 : 0;
  const l = isLE2 ? 0 : 4;
  view.setUint32(byteOffset + h, wh, isLE2);
  view.setUint32(byteOffset + l, wl, isLE2);
}
var SHA2 = class extends Hash {
  constructor(blockLen, outputLen, padOffset, isLE2) {
    super();
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE2;
    this.finished = false;
    this.length = 0;
    this.pos = 0;
    this.destroyed = false;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    exists(this);
    const { view, buffer: buffer2, blockLen } = this;
    data = toBytes(data);
    const len = data.length;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        continue;
      }
      buffer2.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
      }
    }
    this.length += data.length;
    this.roundClean();
    return this;
  }
  digestInto(out) {
    exists(this);
    output(out, this);
    this.finished = true;
    const { buffer: buffer2, view, blockLen, isLE: isLE2 } = this;
    let { pos } = this;
    buffer2[pos++] = 128;
    this.buffer.subarray(pos).fill(0);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      pos = 0;
    }
    for (let i = pos; i < blockLen; i++)
      buffer2[i] = 0;
    setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2);
    this.process(view, 0);
    const oview = createView(out);
    const len = this.outputLen;
    if (len % 4)
      throw new Error("_sha2: outputLen should be aligned to 32bit");
    const outLen = len / 4;
    const state = this.get();
    if (outLen > state.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE2);
  }
  digest() {
    const { buffer: buffer2, outputLen } = this;
    this.digestInto(buffer2);
    const res = buffer2.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    to || (to = new this.constructor());
    to.set(...this.get());
    const { blockLen, buffer: buffer2, length, finished, destroyed, pos } = this;
    to.length = length;
    to.pos = pos;
    to.finished = finished;
    to.destroyed = destroyed;
    if (length % blockLen)
      to.buffer.set(buffer2);
    return to;
  }
};

// node_modules/@noble/hashes/esm/ripemd160.js
var Rho = /* @__PURE__ */ new Uint8Array([7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8]);
var Id = /* @__PURE__ */ Uint8Array.from({ length: 16 }, (_, i) => i);
var Pi = /* @__PURE__ */ Id.map((i) => (9 * i + 5) % 16);
var idxL = [Id];
var idxR = [Pi];
for (let i = 0; i < 4; i++)
  for (let j of [idxL, idxR])
    j.push(j[i].map((k) => Rho[k]));
var shifts = /* @__PURE__ */ [
  [11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8],
  [12, 13, 11, 15, 6, 9, 9, 7, 12, 15, 11, 13, 7, 8, 7, 7],
  [13, 15, 14, 11, 7, 7, 6, 8, 13, 14, 13, 12, 5, 5, 6, 9],
  [14, 11, 12, 14, 8, 6, 5, 5, 15, 12, 15, 14, 9, 9, 8, 6],
  [15, 12, 13, 13, 9, 5, 8, 6, 14, 11, 12, 11, 8, 6, 5, 5]
].map((i) => new Uint8Array(i));
var shiftsL = /* @__PURE__ */ idxL.map((idx, i) => idx.map((j) => shifts[i][j]));
var shiftsR = /* @__PURE__ */ idxR.map((idx, i) => idx.map((j) => shifts[i][j]));
var Kl = /* @__PURE__ */ new Uint32Array([
  0,
  1518500249,
  1859775393,
  2400959708,
  2840853838
]);
var Kr = /* @__PURE__ */ new Uint32Array([
  1352829926,
  1548603684,
  1836072691,
  2053994217,
  0
]);
var rotl = (word, shift) => word << shift | word >>> 32 - shift;
function f(group, x, y, z) {
  if (group === 0)
    return x ^ y ^ z;
  else if (group === 1)
    return x & y | ~x & z;
  else if (group === 2)
    return (x | ~y) ^ z;
  else if (group === 3)
    return x & z | y & ~z;
  else
    return x ^ (y | ~z);
}
var BUF = /* @__PURE__ */ new Uint32Array(16);
var RIPEMD160 = class extends SHA2 {
  constructor() {
    super(64, 20, 8, true);
    this.h0 = 1732584193 | 0;
    this.h1 = 4023233417 | 0;
    this.h2 = 2562383102 | 0;
    this.h3 = 271733878 | 0;
    this.h4 = 3285377520 | 0;
  }
  get() {
    const { h0, h1, h2, h3, h4 } = this;
    return [h0, h1, h2, h3, h4];
  }
  set(h0, h1, h2, h3, h4) {
    this.h0 = h0 | 0;
    this.h1 = h1 | 0;
    this.h2 = h2 | 0;
    this.h3 = h3 | 0;
    this.h4 = h4 | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      BUF[i] = view.getUint32(offset, true);
    let al = this.h0 | 0, ar = al, bl = this.h1 | 0, br = bl, cl = this.h2 | 0, cr = cl, dl = this.h3 | 0, dr = dl, el = this.h4 | 0, er = el;
    for (let group = 0; group < 5; group++) {
      const rGroup = 4 - group;
      const hbl = Kl[group], hbr = Kr[group];
      const rl = idxL[group], rr = idxR[group];
      const sl = shiftsL[group], sr = shiftsR[group];
      for (let i = 0; i < 16; i++) {
        const tl = rotl(al + f(group, bl, cl, dl) + BUF[rl[i]] + hbl, sl[i]) + el | 0;
        al = el, el = dl, dl = rotl(cl, 10) | 0, cl = bl, bl = tl;
      }
      for (let i = 0; i < 16; i++) {
        const tr = rotl(ar + f(rGroup, br, cr, dr) + BUF[rr[i]] + hbr, sr[i]) + er | 0;
        ar = er, er = dr, dr = rotl(cr, 10) | 0, cr = br, br = tr;
      }
    }
    this.set(this.h1 + cl + dr | 0, this.h2 + dl + er | 0, this.h3 + el + ar | 0, this.h4 + al + br | 0, this.h0 + bl + cr | 0);
  }
  roundClean() {
    BUF.fill(0);
  }
  destroy() {
    this.destroyed = true;
    this.buffer.fill(0);
    this.set(0, 0, 0, 0, 0);
  }
};
var ripemd160 = /* @__PURE__ */ wrapConstructor(() => new RIPEMD160());

// node_modules/ethers/lib.esm/crypto/ripemd160.js
var locked4 = false;
var _ripemd160 = function(data) {
  return ripemd160(data);
};
var __ripemd160 = _ripemd160;
function ripemd1602(_data) {
  const data = getBytes(_data, "data");
  return hexlify(__ripemd160(data));
}
ripemd1602._ = _ripemd160;
ripemd1602.lock = function() {
  locked4 = true;
};
ripemd1602.register = function(func) {
  if (locked4) {
    throw new TypeError("ripemd160 is locked");
  }
  __ripemd160 = func;
};
Object.freeze(ripemd1602);

// node_modules/ethers/lib.esm/crypto/pbkdf2.js
var locked5 = false;
var _pbkdf2 = function(password, salt, iterations, keylen, algo) {
  return (0, import_crypto.pbkdf2Sync)(password, salt, iterations, keylen, algo);
};
var __pbkdf2 = _pbkdf2;
function pbkdf2(_password, _salt, iterations, keylen, algo) {
  const password = getBytes(_password, "password");
  const salt = getBytes(_salt, "salt");
  return hexlify(__pbkdf2(password, salt, iterations, keylen, algo));
}
pbkdf2._ = _pbkdf2;
pbkdf2.lock = function() {
  locked5 = true;
};
pbkdf2.register = function(func) {
  if (locked5) {
    throw new Error("pbkdf2 is locked");
  }
  __pbkdf2 = func;
};
Object.freeze(pbkdf2);

// node_modules/ethers/lib.esm/crypto/random.js
var locked6 = false;
var _randomBytes = function(length) {
  return new Uint8Array((0, import_crypto.randomBytes)(length));
};
var __randomBytes = _randomBytes;
function randomBytes3(length) {
  return __randomBytes(length);
}
randomBytes3._ = _randomBytes;
randomBytes3.lock = function() {
  locked6 = true;
};
randomBytes3.register = function(func) {
  if (locked6) {
    throw new Error("randomBytes is locked");
  }
  __randomBytes = func;
};
Object.freeze(randomBytes3);

// node_modules/@noble/hashes/esm/sha256.js
var Chi = (a, b2, c) => a & b2 ^ ~a & c;
var Maj = (a, b2, c) => a & b2 ^ a & c ^ b2 & c;
var SHA256_K = /* @__PURE__ */ new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
var IV = /* @__PURE__ */ new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
var SHA256 = class extends SHA2 {
  constructor() {
    super(64, 32, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T13 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T22 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T13 | 0;
      D = C;
      C = B;
      B = A;
      A = T13 + T22 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    SHA256_W.fill(0);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    this.buffer.fill(0);
  }
};
var sha256 = /* @__PURE__ */ wrapConstructor(() => new SHA256());

// node_modules/@noble/hashes/esm/hmac.js
var HMAC = class extends Hash {
  constructor(hash2, _key) {
    super();
    this.finished = false;
    this.destroyed = false;
    hash(hash2);
    const key = toBytes(_key);
    this.iHash = hash2.create();
    if (typeof this.iHash.update !== "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen;
    this.outputLen = this.iHash.outputLen;
    const blockLen = this.blockLen;
    const pad = new Uint8Array(blockLen);
    pad.set(key.length > blockLen ? hash2.create().update(key).digest() : key);
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54;
    this.iHash.update(pad);
    this.oHash = hash2.create();
    for (let i = 0; i < pad.length; i++)
      pad[i] ^= 54 ^ 92;
    this.oHash.update(pad);
    pad.fill(0);
  }
  update(buf) {
    exists(this);
    this.iHash.update(buf);
    return this;
  }
  digestInto(out) {
    exists(this);
    bytes(out, this.outputLen);
    this.finished = true;
    this.iHash.digestInto(out);
    this.oHash.update(out);
    this.oHash.digestInto(out);
    this.destroy();
  }
  digest() {
    const out = new Uint8Array(this.oHash.outputLen);
    this.digestInto(out);
    return out;
  }
  _cloneInto(to) {
    to || (to = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
    to = to;
    to.finished = finished;
    to.destroyed = destroyed;
    to.blockLen = blockLen;
    to.outputLen = outputLen;
    to.oHash = oHash._cloneInto(to.oHash);
    to.iHash = iHash._cloneInto(to.iHash);
    return to;
  }
  destroy() {
    this.destroyed = true;
    this.oHash.destroy();
    this.iHash.destroy();
  }
};
var hmac = (hash2, key, message) => new HMAC(hash2, key).update(message).digest();
hmac.create = (hash2, key) => new HMAC(hash2, key);

// node_modules/@noble/hashes/esm/pbkdf2.js
function pbkdf2Init(hash2, _password, _salt, _opts) {
  hash(hash2);
  const opts = checkOpts({ dkLen: 32, asyncTick: 10 }, _opts);
  const { c, dkLen, asyncTick } = opts;
  number(c);
  number(dkLen);
  number(asyncTick);
  if (c < 1)
    throw new Error("PBKDF2: iterations (c) should be >= 1");
  const password = toBytes(_password);
  const salt = toBytes(_salt);
  const DK = new Uint8Array(dkLen);
  const PRF = hmac.create(hash2, password);
  const PRFSalt = PRF._cloneInto().update(salt);
  return { c, dkLen, asyncTick, DK, PRF, PRFSalt };
}
function pbkdf2Output(PRF, PRFSalt, DK, prfW, u) {
  PRF.destroy();
  PRFSalt.destroy();
  if (prfW)
    prfW.destroy();
  u.fill(0);
  return DK;
}
function pbkdf22(hash2, password, salt, opts) {
  const { c, dkLen, DK, PRF, PRFSalt } = pbkdf2Init(hash2, password, salt, opts);
  let prfW;
  const arr = new Uint8Array(4);
  const view = createView(arr);
  const u = new Uint8Array(PRF.outputLen);
  for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += PRF.outputLen) {
    const Ti = DK.subarray(pos, pos + PRF.outputLen);
    view.setInt32(0, ti, false);
    (prfW = PRFSalt._cloneInto(prfW)).update(arr).digestInto(u);
    Ti.set(u.subarray(0, Ti.length));
    for (let ui = 1; ui < c; ui++) {
      PRF._cloneInto(prfW).update(u).digestInto(u);
      for (let i = 0; i < Ti.length; i++)
        Ti[i] ^= u[i];
    }
  }
  return pbkdf2Output(PRF, PRFSalt, DK, prfW, u);
}

// node_modules/@noble/hashes/esm/scrypt.js
var rotl2 = (a, b2) => a << b2 | a >>> 32 - b2;
function XorAndSalsa(prev, pi, input, ii, out, oi) {
  let y00 = prev[pi++] ^ input[ii++], y01 = prev[pi++] ^ input[ii++];
  let y02 = prev[pi++] ^ input[ii++], y03 = prev[pi++] ^ input[ii++];
  let y04 = prev[pi++] ^ input[ii++], y05 = prev[pi++] ^ input[ii++];
  let y06 = prev[pi++] ^ input[ii++], y07 = prev[pi++] ^ input[ii++];
  let y08 = prev[pi++] ^ input[ii++], y09 = prev[pi++] ^ input[ii++];
  let y10 = prev[pi++] ^ input[ii++], y11 = prev[pi++] ^ input[ii++];
  let y12 = prev[pi++] ^ input[ii++], y13 = prev[pi++] ^ input[ii++];
  let y14 = prev[pi++] ^ input[ii++], y15 = prev[pi++] ^ input[ii++];
  let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
  for (let i = 0; i < 8; i += 2) {
    x04 ^= rotl2(x00 + x12 | 0, 7);
    x08 ^= rotl2(x04 + x00 | 0, 9);
    x12 ^= rotl2(x08 + x04 | 0, 13);
    x00 ^= rotl2(x12 + x08 | 0, 18);
    x09 ^= rotl2(x05 + x01 | 0, 7);
    x13 ^= rotl2(x09 + x05 | 0, 9);
    x01 ^= rotl2(x13 + x09 | 0, 13);
    x05 ^= rotl2(x01 + x13 | 0, 18);
    x14 ^= rotl2(x10 + x06 | 0, 7);
    x02 ^= rotl2(x14 + x10 | 0, 9);
    x06 ^= rotl2(x02 + x14 | 0, 13);
    x10 ^= rotl2(x06 + x02 | 0, 18);
    x03 ^= rotl2(x15 + x11 | 0, 7);
    x07 ^= rotl2(x03 + x15 | 0, 9);
    x11 ^= rotl2(x07 + x03 | 0, 13);
    x15 ^= rotl2(x11 + x07 | 0, 18);
    x01 ^= rotl2(x00 + x03 | 0, 7);
    x02 ^= rotl2(x01 + x00 | 0, 9);
    x03 ^= rotl2(x02 + x01 | 0, 13);
    x00 ^= rotl2(x03 + x02 | 0, 18);
    x06 ^= rotl2(x05 + x04 | 0, 7);
    x07 ^= rotl2(x06 + x05 | 0, 9);
    x04 ^= rotl2(x07 + x06 | 0, 13);
    x05 ^= rotl2(x04 + x07 | 0, 18);
    x11 ^= rotl2(x10 + x09 | 0, 7);
    x08 ^= rotl2(x11 + x10 | 0, 9);
    x09 ^= rotl2(x08 + x11 | 0, 13);
    x10 ^= rotl2(x09 + x08 | 0, 18);
    x12 ^= rotl2(x15 + x14 | 0, 7);
    x13 ^= rotl2(x12 + x15 | 0, 9);
    x14 ^= rotl2(x13 + x12 | 0, 13);
    x15 ^= rotl2(x14 + x13 | 0, 18);
  }
  out[oi++] = y00 + x00 | 0;
  out[oi++] = y01 + x01 | 0;
  out[oi++] = y02 + x02 | 0;
  out[oi++] = y03 + x03 | 0;
  out[oi++] = y04 + x04 | 0;
  out[oi++] = y05 + x05 | 0;
  out[oi++] = y06 + x06 | 0;
  out[oi++] = y07 + x07 | 0;
  out[oi++] = y08 + x08 | 0;
  out[oi++] = y09 + x09 | 0;
  out[oi++] = y10 + x10 | 0;
  out[oi++] = y11 + x11 | 0;
  out[oi++] = y12 + x12 | 0;
  out[oi++] = y13 + x13 | 0;
  out[oi++] = y14 + x14 | 0;
  out[oi++] = y15 + x15 | 0;
}
function BlockMix(input, ii, out, oi, r) {
  let head = oi + 0;
  let tail = oi + 16 * r;
  for (let i = 0; i < 16; i++)
    out[tail + i] = input[ii + (2 * r - 1) * 16 + i];
  for (let i = 0; i < r; i++, head += 16, ii += 16) {
    XorAndSalsa(out, tail, input, ii, out, head);
    if (i > 0)
      tail += 16;
    XorAndSalsa(out, head, input, ii += 16, out, tail);
  }
}
function scryptInit(password, salt, _opts) {
  const opts = checkOpts({
    dkLen: 32,
    asyncTick: 10,
    maxmem: 1024 ** 3 + 1024
  }, _opts);
  const { N: N2, r, p, dkLen, asyncTick, maxmem, onProgress } = opts;
  number(N2);
  number(r);
  number(p);
  number(dkLen);
  number(asyncTick);
  number(maxmem);
  if (onProgress !== void 0 && typeof onProgress !== "function")
    throw new Error("progressCb should be function");
  const blockSize = 128 * r;
  const blockSize32 = blockSize / 4;
  if (N2 <= 1 || (N2 & N2 - 1) !== 0 || N2 >= 2 ** (blockSize / 8) || N2 > 2 ** 32) {
    throw new Error("Scrypt: N must be larger than 1, a power of 2, less than 2^(128 * r / 8) and less than 2^32");
  }
  if (p < 0 || p > (2 ** 32 - 1) * 32 / blockSize) {
    throw new Error("Scrypt: p must be a positive integer less than or equal to ((2^32 - 1) * 32) / (128 * r)");
  }
  if (dkLen < 0 || dkLen > (2 ** 32 - 1) * 32) {
    throw new Error("Scrypt: dkLen should be positive integer less than or equal to (2^32 - 1) * 32");
  }
  const memUsed = blockSize * (N2 + p);
  if (memUsed > maxmem) {
    throw new Error(`Scrypt: parameters too large, ${memUsed} (128 * r * (N + p)) > ${maxmem} (maxmem)`);
  }
  const B = pbkdf22(sha256, password, salt, { c: 1, dkLen: blockSize * p });
  const B32 = u32(B);
  const V = u32(new Uint8Array(blockSize * N2));
  const tmp = u32(new Uint8Array(blockSize));
  let blockMixCb = () => {
  };
  if (onProgress) {
    const totalBlockMix = 2 * N2 * p;
    const callbackPer = Math.max(Math.floor(totalBlockMix / 1e4), 1);
    let blockMixCnt = 0;
    blockMixCb = () => {
      blockMixCnt++;
      if (onProgress && (!(blockMixCnt % callbackPer) || blockMixCnt === totalBlockMix))
        onProgress(blockMixCnt / totalBlockMix);
    };
  }
  return { N: N2, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick };
}
function scryptOutput(password, dkLen, B, V, tmp) {
  const res = pbkdf22(sha256, password, B, { c: 1, dkLen });
  B.fill(0);
  V.fill(0);
  tmp.fill(0);
  return res;
}
function scrypt(password, salt, opts) {
  const { N: N2, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb } = scryptInit(password, salt, opts);
  for (let pi = 0; pi < p; pi++) {
    const Pi2 = blockSize32 * pi;
    for (let i = 0; i < blockSize32; i++)
      V[i] = B32[Pi2 + i];
    for (let i = 0, pos = 0; i < N2 - 1; i++) {
      BlockMix(V, pos, V, pos += blockSize32, r);
      blockMixCb();
    }
    BlockMix(V, (N2 - 1) * blockSize32, B32, Pi2, r);
    blockMixCb();
    for (let i = 0; i < N2; i++) {
      const j = B32[Pi2 + blockSize32 - 16] % N2;
      for (let k = 0; k < blockSize32; k++)
        tmp[k] = B32[Pi2 + k] ^ V[j * blockSize32 + k];
      BlockMix(tmp, 0, B32, Pi2, r);
      blockMixCb();
    }
  }
  return scryptOutput(password, dkLen, B, V, tmp);
}
async function scryptAsync(password, salt, opts) {
  const { N: N2, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick } = scryptInit(password, salt, opts);
  for (let pi = 0; pi < p; pi++) {
    const Pi2 = blockSize32 * pi;
    for (let i = 0; i < blockSize32; i++)
      V[i] = B32[Pi2 + i];
    let pos = 0;
    await asyncLoop(N2 - 1, asyncTick, () => {
      BlockMix(V, pos, V, pos += blockSize32, r);
      blockMixCb();
    });
    BlockMix(V, (N2 - 1) * blockSize32, B32, Pi2, r);
    blockMixCb();
    await asyncLoop(N2, asyncTick, () => {
      const j = B32[Pi2 + blockSize32 - 16] % N2;
      for (let k = 0; k < blockSize32; k++)
        tmp[k] = B32[Pi2 + k] ^ V[j * blockSize32 + k];
      BlockMix(tmp, 0, B32, Pi2, r);
      blockMixCb();
    });
  }
  return scryptOutput(password, dkLen, B, V, tmp);
}

// node_modules/ethers/lib.esm/crypto/scrypt.js
var lockedSync = false;
var lockedAsync = false;
var _scryptAsync = async function(passwd, salt, N2, r, p, dkLen, onProgress) {
  return await scryptAsync(passwd, salt, { N: N2, r, p, dkLen, onProgress });
};
var _scryptSync = function(passwd, salt, N2, r, p, dkLen) {
  return scrypt(passwd, salt, { N: N2, r, p, dkLen });
};
var __scryptAsync = _scryptAsync;
var __scryptSync = _scryptSync;
async function scrypt2(_passwd, _salt, N2, r, p, dkLen, progress) {
  const passwd = getBytes(_passwd, "passwd");
  const salt = getBytes(_salt, "salt");
  return hexlify(await __scryptAsync(passwd, salt, N2, r, p, dkLen, progress));
}
scrypt2._ = _scryptAsync;
scrypt2.lock = function() {
  lockedAsync = true;
};
scrypt2.register = function(func) {
  if (lockedAsync) {
    throw new Error("scrypt is locked");
  }
  __scryptAsync = func;
};
Object.freeze(scrypt2);
function scryptSync(_passwd, _salt, N2, r, p, dkLen) {
  const passwd = getBytes(_passwd, "passwd");
  const salt = getBytes(_salt, "salt");
  return hexlify(__scryptSync(passwd, salt, N2, r, p, dkLen));
}
scryptSync._ = _scryptSync;
scryptSync.lock = function() {
  lockedSync = true;
};
scryptSync.register = function(func) {
  if (lockedSync) {
    throw new Error("scryptSync is locked");
  }
  __scryptSync = func;
};
Object.freeze(scryptSync);

// node_modules/ethers/lib.esm/crypto/sha2.js
var _sha256 = function(data) {
  return (0, import_crypto.createHash)("sha256").update(data).digest();
};
var _sha512 = function(data) {
  return (0, import_crypto.createHash)("sha512").update(data).digest();
};
var __sha256 = _sha256;
var __sha512 = _sha512;
var locked256 = false;
var locked512 = false;
function sha2562(_data) {
  const data = getBytes(_data, "data");
  return hexlify(__sha256(data));
}
sha2562._ = _sha256;
sha2562.lock = function() {
  locked256 = true;
};
sha2562.register = function(func) {
  if (locked256) {
    throw new Error("sha256 is locked");
  }
  __sha256 = func;
};
Object.freeze(sha2562);
function sha512(_data) {
  const data = getBytes(_data, "data");
  return hexlify(__sha512(data));
}
sha512._ = _sha512;
sha512.lock = function() {
  locked512 = true;
};
sha512.register = function(func) {
  if (locked512) {
    throw new Error("sha512 is locked");
  }
  __sha512 = func;
};
Object.freeze(sha2562);

// node_modules/@noble/curves/esm/abstract/utils.js
var utils_exports = {};
__export(utils_exports, {
  bitGet: () => bitGet,
  bitLen: () => bitLen,
  bitMask: () => bitMask,
  bitSet: () => bitSet,
  bytesToHex: () => bytesToHex,
  bytesToNumberBE: () => bytesToNumberBE,
  bytesToNumberLE: () => bytesToNumberLE,
  concatBytes: () => concatBytes2,
  createHmacDrbg: () => createHmacDrbg,
  ensureBytes: () => ensureBytes,
  equalBytes: () => equalBytes,
  hexToBytes: () => hexToBytes,
  hexToNumber: () => hexToNumber,
  numberToBytesBE: () => numberToBytesBE,
  numberToBytesLE: () => numberToBytesLE,
  numberToHexUnpadded: () => numberToHexUnpadded,
  numberToVarBytesBE: () => numberToVarBytesBE,
  utf8ToBytes: () => utf8ToBytes2,
  validateObject: () => validateObject
});
var _0n2 = BigInt(0);
var _1n2 = BigInt(1);
var _2n2 = BigInt(2);
var u8a2 = (a) => a instanceof Uint8Array;
var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
function bytesToHex(bytes2) {
  if (!u8a2(bytes2))
    throw new Error("Uint8Array expected");
  let hex = "";
  for (let i = 0; i < bytes2.length; i++) {
    hex += hexes[bytes2[i]];
  }
  return hex;
}
function numberToHexUnpadded(num) {
  const hex = num.toString(16);
  return hex.length & 1 ? `0${hex}` : hex;
}
function hexToNumber(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  return BigInt(hex === "" ? "0" : `0x${hex}`);
}
function hexToBytes(hex) {
  if (typeof hex !== "string")
    throw new Error("hex string expected, got " + typeof hex);
  const len = hex.length;
  if (len % 2)
    throw new Error("padded hex string expected, got unpadded hex of length " + len);
  const array = new Uint8Array(len / 2);
  for (let i = 0; i < array.length; i++) {
    const j = i * 2;
    const hexByte = hex.slice(j, j + 2);
    const byte = Number.parseInt(hexByte, 16);
    if (Number.isNaN(byte) || byte < 0)
      throw new Error("Invalid byte sequence");
    array[i] = byte;
  }
  return array;
}
function bytesToNumberBE(bytes2) {
  return hexToNumber(bytesToHex(bytes2));
}
function bytesToNumberLE(bytes2) {
  if (!u8a2(bytes2))
    throw new Error("Uint8Array expected");
  return hexToNumber(bytesToHex(Uint8Array.from(bytes2).reverse()));
}
function numberToBytesBE(n2, len) {
  return hexToBytes(n2.toString(16).padStart(len * 2, "0"));
}
function numberToBytesLE(n2, len) {
  return numberToBytesBE(n2, len).reverse();
}
function numberToVarBytesBE(n2) {
  return hexToBytes(numberToHexUnpadded(n2));
}
function ensureBytes(title, hex, expectedLength) {
  let res;
  if (typeof hex === "string") {
    try {
      res = hexToBytes(hex);
    } catch (e) {
      throw new Error(`${title} must be valid hex string, got "${hex}". Cause: ${e}`);
    }
  } else if (u8a2(hex)) {
    res = Uint8Array.from(hex);
  } else {
    throw new Error(`${title} must be hex string or Uint8Array`);
  }
  const len = res.length;
  if (typeof expectedLength === "number" && len !== expectedLength)
    throw new Error(`${title} expected ${expectedLength} bytes, got ${len}`);
  return res;
}
function concatBytes2(...arrays) {
  const r = new Uint8Array(arrays.reduce((sum, a) => sum + a.length, 0));
  let pad = 0;
  arrays.forEach((a) => {
    if (!u8a2(a))
      throw new Error("Uint8Array expected");
    r.set(a, pad);
    pad += a.length;
  });
  return r;
}
function equalBytes(b1, b2) {
  if (b1.length !== b2.length)
    return false;
  for (let i = 0; i < b1.length; i++)
    if (b1[i] !== b2[i])
      return false;
  return true;
}
function utf8ToBytes2(str) {
  if (typeof str !== "string")
    throw new Error(`utf8ToBytes expected string, got ${typeof str}`);
  return new Uint8Array(new TextEncoder().encode(str));
}
function bitLen(n2) {
  let len;
  for (len = 0; n2 > _0n2; n2 >>= _1n2, len += 1)
    ;
  return len;
}
function bitGet(n2, pos) {
  return n2 >> BigInt(pos) & _1n2;
}
var bitSet = (n2, pos, value) => {
  return n2 | (value ? _1n2 : _0n2) << BigInt(pos);
};
var bitMask = (n2) => (_2n2 << BigInt(n2 - 1)) - _1n2;
var u8n = (data) => new Uint8Array(data);
var u8fr = (arr) => Uint8Array.from(arr);
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
  if (typeof hashLen !== "number" || hashLen < 2)
    throw new Error("hashLen must be a number");
  if (typeof qByteLen !== "number" || qByteLen < 2)
    throw new Error("qByteLen must be a number");
  if (typeof hmacFn !== "function")
    throw new Error("hmacFn must be a function");
  let v = u8n(hashLen);
  let k = u8n(hashLen);
  let i = 0;
  const reset = () => {
    v.fill(1);
    k.fill(0);
    i = 0;
  };
  const h = (...b2) => hmacFn(k, v, ...b2);
  const reseed = (seed = u8n()) => {
    k = h(u8fr([0]), seed);
    v = h();
    if (seed.length === 0)
      return;
    k = h(u8fr([1]), seed);
    v = h();
  };
  const gen2 = () => {
    if (i++ >= 1e3)
      throw new Error("drbg: tried 1000 values");
    let len = 0;
    const out = [];
    while (len < qByteLen) {
      v = h();
      const sl = v.slice();
      out.push(sl);
      len += v.length;
    }
    return concatBytes2(...out);
  };
  const genUntil = (seed, pred) => {
    reset();
    reseed(seed);
    let res = void 0;
    while (!(res = pred(gen2())))
      reseed();
    reset();
    return res;
  };
  return genUntil;
}
var validatorFns = {
  bigint: (val) => typeof val === "bigint",
  function: (val) => typeof val === "function",
  boolean: (val) => typeof val === "boolean",
  string: (val) => typeof val === "string",
  stringOrUint8Array: (val) => typeof val === "string" || val instanceof Uint8Array,
  isSafeInteger: (val) => Number.isSafeInteger(val),
  array: (val) => Array.isArray(val),
  field: (val, object2) => object2.Fp.isValid(val),
  hash: (val) => typeof val === "function" && Number.isSafeInteger(val.outputLen)
};
function validateObject(object2, validators, optValidators = {}) {
  const checkField = (fieldName, type, isOptional) => {
    const checkVal = validatorFns[type];
    if (typeof checkVal !== "function")
      throw new Error(`Invalid validator "${type}", expected function`);
    const val = object2[fieldName];
    if (isOptional && val === void 0)
      return;
    if (!checkVal(val, object2)) {
      throw new Error(`Invalid param ${String(fieldName)}=${val} (${typeof val}), expected ${type}`);
    }
  };
  for (const [fieldName, type] of Object.entries(validators))
    checkField(fieldName, type, false);
  for (const [fieldName, type] of Object.entries(optValidators))
    checkField(fieldName, type, true);
  return object2;
}

// node_modules/@noble/curves/esm/abstract/modular.js
var _0n3 = BigInt(0);
var _1n3 = BigInt(1);
var _2n3 = BigInt(2);
var _3n = BigInt(3);
var _4n = BigInt(4);
var _5n = BigInt(5);
var _8n = BigInt(8);
var _9n = BigInt(9);
var _16n = BigInt(16);
function mod(a, b2) {
  const result2 = a % b2;
  return result2 >= _0n3 ? result2 : b2 + result2;
}
function pow(num, power, modulo) {
  if (modulo <= _0n3 || power < _0n3)
    throw new Error("Expected power/modulo > 0");
  if (modulo === _1n3)
    return _0n3;
  let res = _1n3;
  while (power > _0n3) {
    if (power & _1n3)
      res = res * num % modulo;
    num = num * num % modulo;
    power >>= _1n3;
  }
  return res;
}
function pow2(x, power, modulo) {
  let res = x;
  while (power-- > _0n3) {
    res *= res;
    res %= modulo;
  }
  return res;
}
function invert(number2, modulo) {
  if (number2 === _0n3 || modulo <= _0n3) {
    throw new Error(`invert: expected positive integers, got n=${number2} mod=${modulo}`);
  }
  let a = mod(number2, modulo);
  let b2 = modulo;
  let x = _0n3, y = _1n3, u = _1n3, v = _0n3;
  while (a !== _0n3) {
    const q = b2 / a;
    const r = b2 % a;
    const m = x - u * q;
    const n2 = y - v * q;
    b2 = a, a = r, x = u, y = v, u = m, v = n2;
  }
  const gcd = b2;
  if (gcd !== _1n3)
    throw new Error("invert: does not exist");
  return mod(x, modulo);
}
function tonelliShanks(P) {
  const legendreC = (P - _1n3) / _2n3;
  let Q, S2, Z;
  for (Q = P - _1n3, S2 = 0; Q % _2n3 === _0n3; Q /= _2n3, S2++)
    ;
  for (Z = _2n3; Z < P && pow(Z, legendreC, P) !== P - _1n3; Z++)
    ;
  if (S2 === 1) {
    const p1div4 = (P + _1n3) / _4n;
    return function tonelliFast(Fp2, n2) {
      const root = Fp2.pow(n2, p1div4);
      if (!Fp2.eql(Fp2.sqr(root), n2))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  const Q1div2 = (Q + _1n3) / _2n3;
  return function tonelliSlow(Fp2, n2) {
    if (Fp2.pow(n2, legendreC) === Fp2.neg(Fp2.ONE))
      throw new Error("Cannot find square root");
    let r = S2;
    let g = Fp2.pow(Fp2.mul(Fp2.ONE, Z), Q);
    let x = Fp2.pow(n2, Q1div2);
    let b2 = Fp2.pow(n2, Q);
    while (!Fp2.eql(b2, Fp2.ONE)) {
      if (Fp2.eql(b2, Fp2.ZERO))
        return Fp2.ZERO;
      let m = 1;
      for (let t2 = Fp2.sqr(b2); m < r; m++) {
        if (Fp2.eql(t2, Fp2.ONE))
          break;
        t2 = Fp2.sqr(t2);
      }
      const ge = Fp2.pow(g, _1n3 << BigInt(r - m - 1));
      g = Fp2.sqr(ge);
      x = Fp2.mul(x, ge);
      b2 = Fp2.mul(b2, g);
      r = m;
    }
    return x;
  };
}
function FpSqrt(P) {
  if (P % _4n === _3n) {
    const p1div4 = (P + _1n3) / _4n;
    return function sqrt3mod4(Fp2, n2) {
      const root = Fp2.pow(n2, p1div4);
      if (!Fp2.eql(Fp2.sqr(root), n2))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  if (P % _8n === _5n) {
    const c1 = (P - _5n) / _8n;
    return function sqrt5mod8(Fp2, n2) {
      const n22 = Fp2.mul(n2, _2n3);
      const v = Fp2.pow(n22, c1);
      const nv = Fp2.mul(n2, v);
      const i = Fp2.mul(Fp2.mul(nv, _2n3), v);
      const root = Fp2.mul(nv, Fp2.sub(i, Fp2.ONE));
      if (!Fp2.eql(Fp2.sqr(root), n2))
        throw new Error("Cannot find square root");
      return root;
    };
  }
  if (P % _16n === _9n) {
  }
  return tonelliShanks(P);
}
var FIELD_FIELDS = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function validateField(field) {
  const initial = {
    ORDER: "bigint",
    MASK: "bigint",
    BYTES: "isSafeInteger",
    BITS: "isSafeInteger"
  };
  const opts = FIELD_FIELDS.reduce((map, val) => {
    map[val] = "function";
    return map;
  }, initial);
  return validateObject(field, opts);
}
function FpPow(f2, num, power) {
  if (power < _0n3)
    throw new Error("Expected power > 0");
  if (power === _0n3)
    return f2.ONE;
  if (power === _1n3)
    return num;
  let p = f2.ONE;
  let d = num;
  while (power > _0n3) {
    if (power & _1n3)
      p = f2.mul(p, d);
    d = f2.sqr(d);
    power >>= _1n3;
  }
  return p;
}
function FpInvertBatch(f2, nums) {
  const tmp = new Array(nums.length);
  const lastMultiplied = nums.reduce((acc, num, i) => {
    if (f2.is0(num))
      return acc;
    tmp[i] = acc;
    return f2.mul(acc, num);
  }, f2.ONE);
  const inverted = f2.inv(lastMultiplied);
  nums.reduceRight((acc, num, i) => {
    if (f2.is0(num))
      return acc;
    tmp[i] = f2.mul(acc, tmp[i]);
    return f2.mul(acc, num);
  }, inverted);
  return tmp;
}
function nLength(n2, nBitLength) {
  const _nBitLength = nBitLength !== void 0 ? nBitLength : n2.toString(2).length;
  const nByteLength = Math.ceil(_nBitLength / 8);
  return { nBitLength: _nBitLength, nByteLength };
}
function Field(ORDER, bitLen2, isLE2 = false, redef = {}) {
  if (ORDER <= _0n3)
    throw new Error(`Expected Field ORDER > 0, got ${ORDER}`);
  const { nBitLength: BITS, nByteLength: BYTES } = nLength(ORDER, bitLen2);
  if (BYTES > 2048)
    throw new Error("Field lengths over 2048 bytes are not supported");
  const sqrtP = FpSqrt(ORDER);
  const f2 = Object.freeze({
    ORDER,
    BITS,
    BYTES,
    MASK: bitMask(BITS),
    ZERO: _0n3,
    ONE: _1n3,
    create: (num) => mod(num, ORDER),
    isValid: (num) => {
      if (typeof num !== "bigint")
        throw new Error(`Invalid field element: expected bigint, got ${typeof num}`);
      return _0n3 <= num && num < ORDER;
    },
    is0: (num) => num === _0n3,
    isOdd: (num) => (num & _1n3) === _1n3,
    neg: (num) => mod(-num, ORDER),
    eql: (lhs, rhs) => lhs === rhs,
    sqr: (num) => mod(num * num, ORDER),
    add: (lhs, rhs) => mod(lhs + rhs, ORDER),
    sub: (lhs, rhs) => mod(lhs - rhs, ORDER),
    mul: (lhs, rhs) => mod(lhs * rhs, ORDER),
    pow: (num, power) => FpPow(f2, num, power),
    div: (lhs, rhs) => mod(lhs * invert(rhs, ORDER), ORDER),
    // Same as above, but doesn't normalize
    sqrN: (num) => num * num,
    addN: (lhs, rhs) => lhs + rhs,
    subN: (lhs, rhs) => lhs - rhs,
    mulN: (lhs, rhs) => lhs * rhs,
    inv: (num) => invert(num, ORDER),
    sqrt: redef.sqrt || ((n2) => sqrtP(f2, n2)),
    invertBatch: (lst) => FpInvertBatch(f2, lst),
    // TODO: do we really need constant cmov?
    // We don't have const-time bigints anyway, so probably will be not very useful
    cmov: (a, b2, c) => c ? b2 : a,
    toBytes: (num) => isLE2 ? numberToBytesLE(num, BYTES) : numberToBytesBE(num, BYTES),
    fromBytes: (bytes2) => {
      if (bytes2.length !== BYTES)
        throw new Error(`Fp.fromBytes: expected ${BYTES}, got ${bytes2.length}`);
      return isLE2 ? bytesToNumberLE(bytes2) : bytesToNumberBE(bytes2);
    }
  });
  return Object.freeze(f2);
}
function getFieldBytesLength(fieldOrder) {
  if (typeof fieldOrder !== "bigint")
    throw new Error("field order must be bigint");
  const bitLength = fieldOrder.toString(2).length;
  return Math.ceil(bitLength / 8);
}
function getMinHashLength(fieldOrder) {
  const length = getFieldBytesLength(fieldOrder);
  return length + Math.ceil(length / 2);
}
function mapHashToField(key, fieldOrder, isLE2 = false) {
  const len = key.length;
  const fieldLen = getFieldBytesLength(fieldOrder);
  const minLen = getMinHashLength(fieldOrder);
  if (len < 16 || len < minLen || len > 1024)
    throw new Error(`expected ${minLen}-1024 bytes of input, got ${len}`);
  const num = isLE2 ? bytesToNumberBE(key) : bytesToNumberLE(key);
  const reduced = mod(num, fieldOrder - _1n3) + _1n3;
  return isLE2 ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}

// node_modules/@noble/curves/esm/abstract/curve.js
var _0n4 = BigInt(0);
var _1n4 = BigInt(1);
function wNAF(c, bits) {
  const constTimeNegate = (condition, item) => {
    const neg = item.negate();
    return condition ? neg : item;
  };
  const opts = (W) => {
    const windows = Math.ceil(bits / W) + 1;
    const windowSize = 2 ** (W - 1);
    return { windows, windowSize };
  };
  return {
    constTimeNegate,
    // non-const time multiplication ladder
    unsafeLadder(elm, n2) {
      let p = c.ZERO;
      let d = elm;
      while (n2 > _0n4) {
        if (n2 & _1n4)
          p = p.add(d);
        d = d.double();
        n2 >>= _1n4;
      }
      return p;
    },
    /**
     * Creates a wNAF precomputation window. Used for caching.
     * Default window size is set by `utils.precompute()` and is equal to 8.
     * Number of precomputed points depends on the curve size:
     * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
     * - 𝑊 is the window size
     * - 𝑛 is the bitlength of the curve order.
     * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
     * @returns precomputed point tables flattened to a single array
     */
    precomputeWindow(elm, W) {
      const { windows, windowSize } = opts(W);
      const points = [];
      let p = elm;
      let base = p;
      for (let window = 0; window < windows; window++) {
        base = p;
        points.push(base);
        for (let i = 1; i < windowSize; i++) {
          base = base.add(p);
          points.push(base);
        }
        p = base.double();
      }
      return points;
    },
    /**
     * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
     * @param W window size
     * @param precomputes precomputed tables
     * @param n scalar (we don't check here, but should be less than curve order)
     * @returns real and fake (for const-time) points
     */
    wNAF(W, precomputes, n2) {
      const { windows, windowSize } = opts(W);
      let p = c.ZERO;
      let f2 = c.BASE;
      const mask2 = BigInt(2 ** W - 1);
      const maxNumber = 2 ** W;
      const shiftBy = BigInt(W);
      for (let window = 0; window < windows; window++) {
        const offset = window * windowSize;
        let wbits = Number(n2 & mask2);
        n2 >>= shiftBy;
        if (wbits > windowSize) {
          wbits -= maxNumber;
          n2 += _1n4;
        }
        const offset1 = offset;
        const offset2 = offset + Math.abs(wbits) - 1;
        const cond1 = window % 2 !== 0;
        const cond2 = wbits < 0;
        if (wbits === 0) {
          f2 = f2.add(constTimeNegate(cond1, precomputes[offset1]));
        } else {
          p = p.add(constTimeNegate(cond2, precomputes[offset2]));
        }
      }
      return { p, f: f2 };
    },
    wNAFCached(P, precomputesMap, n2, transform) {
      const W = P._WINDOW_SIZE || 1;
      let comp = precomputesMap.get(P);
      if (!comp) {
        comp = this.precomputeWindow(P, W);
        if (W !== 1) {
          precomputesMap.set(P, transform(comp));
        }
      }
      return this.wNAF(W, comp, n2);
    }
  };
}
function validateBasic(curve) {
  validateField(curve.Fp);
  validateObject(curve, {
    n: "bigint",
    h: "bigint",
    Gx: "field",
    Gy: "field"
  }, {
    nBitLength: "isSafeInteger",
    nByteLength: "isSafeInteger"
  });
  return Object.freeze({
    ...nLength(curve.n, curve.nBitLength),
    ...curve,
    ...{ p: curve.Fp.ORDER }
  });
}

// node_modules/@noble/curves/esm/abstract/weierstrass.js
function validatePointOpts(curve) {
  const opts = validateBasic(curve);
  validateObject(opts, {
    a: "field",
    b: "field"
  }, {
    allowedPrivateKeyLengths: "array",
    wrapPrivateKey: "boolean",
    isTorsionFree: "function",
    clearCofactor: "function",
    allowInfinityPoint: "boolean",
    fromBytes: "function",
    toBytes: "function"
  });
  const { endo, Fp: Fp2, a } = opts;
  if (endo) {
    if (!Fp2.eql(a, Fp2.ZERO)) {
      throw new Error("Endomorphism can only be defined for Koblitz curves that have a=0");
    }
    if (typeof endo !== "object" || typeof endo.beta !== "bigint" || typeof endo.splitScalar !== "function") {
      throw new Error("Expected endomorphism with beta: bigint and splitScalar: function");
    }
  }
  return Object.freeze({ ...opts });
}
var { bytesToNumberBE: b2n, hexToBytes: h2b } = utils_exports;
var DER = {
  // asn.1 DER encoding utils
  Err: class DERErr extends Error {
    constructor(m = "") {
      super(m);
    }
  },
  _parseInt(data) {
    const { Err: E } = DER;
    if (data.length < 2 || data[0] !== 2)
      throw new E("Invalid signature integer tag");
    const len = data[1];
    const res = data.subarray(2, len + 2);
    if (!len || res.length !== len)
      throw new E("Invalid signature integer: wrong length");
    if (res[0] & 128)
      throw new E("Invalid signature integer: negative");
    if (res[0] === 0 && !(res[1] & 128))
      throw new E("Invalid signature integer: unnecessary leading zero");
    return { d: b2n(res), l: data.subarray(len + 2) };
  },
  toSig(hex) {
    const { Err: E } = DER;
    const data = typeof hex === "string" ? h2b(hex) : hex;
    if (!(data instanceof Uint8Array))
      throw new Error("ui8a expected");
    let l = data.length;
    if (l < 2 || data[0] != 48)
      throw new E("Invalid signature tag");
    if (data[1] !== l - 2)
      throw new E("Invalid signature: incorrect length");
    const { d: r, l: sBytes } = DER._parseInt(data.subarray(2));
    const { d: s, l: rBytesLeft } = DER._parseInt(sBytes);
    if (rBytesLeft.length)
      throw new E("Invalid signature: left bytes after parsing");
    return { r, s };
  },
  hexFromSig(sig) {
    const slice = (s2) => Number.parseInt(s2[0], 16) & 8 ? "00" + s2 : s2;
    const h = (num) => {
      const hex = num.toString(16);
      return hex.length & 1 ? `0${hex}` : hex;
    };
    const s = slice(h(sig.s));
    const r = slice(h(sig.r));
    const shl = s.length / 2;
    const rhl = r.length / 2;
    const sl = h(shl);
    const rl = h(rhl);
    return `30${h(rhl + shl + 4)}02${rl}${r}02${sl}${s}`;
  }
};
var _0n5 = BigInt(0);
var _1n5 = BigInt(1);
var _2n4 = BigInt(2);
var _3n2 = BigInt(3);
var _4n2 = BigInt(4);
function weierstrassPoints(opts) {
  const CURVE = validatePointOpts(opts);
  const { Fp: Fp2 } = CURVE;
  const toBytes2 = CURVE.toBytes || ((_c, point, _isCompressed) => {
    const a = point.toAffine();
    return concatBytes2(Uint8Array.from([4]), Fp2.toBytes(a.x), Fp2.toBytes(a.y));
  });
  const fromBytes = CURVE.fromBytes || ((bytes2) => {
    const tail = bytes2.subarray(1);
    const x = Fp2.fromBytes(tail.subarray(0, Fp2.BYTES));
    const y = Fp2.fromBytes(tail.subarray(Fp2.BYTES, 2 * Fp2.BYTES));
    return { x, y };
  });
  function weierstrassEquation(x) {
    const { a, b: b2 } = CURVE;
    const x2 = Fp2.sqr(x);
    const x3 = Fp2.mul(x2, x);
    return Fp2.add(Fp2.add(x3, Fp2.mul(x, a)), b2);
  }
  if (!Fp2.eql(Fp2.sqr(CURVE.Gy), weierstrassEquation(CURVE.Gx)))
    throw new Error("bad generator point: equation left != right");
  function isWithinCurveOrder(num) {
    return typeof num === "bigint" && _0n5 < num && num < CURVE.n;
  }
  function assertGE(num) {
    if (!isWithinCurveOrder(num))
      throw new Error("Expected valid bigint: 0 < bigint < curve.n");
  }
  function normPrivateKeyToScalar(key) {
    const { allowedPrivateKeyLengths: lengths, nByteLength, wrapPrivateKey, n: n2 } = CURVE;
    if (lengths && typeof key !== "bigint") {
      if (key instanceof Uint8Array)
        key = bytesToHex(key);
      if (typeof key !== "string" || !lengths.includes(key.length))
        throw new Error("Invalid key");
      key = key.padStart(nByteLength * 2, "0");
    }
    let num;
    try {
      num = typeof key === "bigint" ? key : bytesToNumberBE(ensureBytes("private key", key, nByteLength));
    } catch (error) {
      throw new Error(`private key must be ${nByteLength} bytes, hex or bigint, not ${typeof key}`);
    }
    if (wrapPrivateKey)
      num = mod(num, n2);
    assertGE(num);
    return num;
  }
  const pointPrecomputes = /* @__PURE__ */ new Map();
  function assertPrjPoint(other) {
    if (!(other instanceof Point2))
      throw new Error("ProjectivePoint expected");
  }
  class Point2 {
    constructor(px, py, pz) {
      this.px = px;
      this.py = py;
      this.pz = pz;
      if (px == null || !Fp2.isValid(px))
        throw new Error("x required");
      if (py == null || !Fp2.isValid(py))
        throw new Error("y required");
      if (pz == null || !Fp2.isValid(pz))
        throw new Error("z required");
    }
    // Does not validate if the point is on-curve.
    // Use fromHex instead, or call assertValidity() later.
    static fromAffine(p) {
      const { x, y } = p || {};
      if (!p || !Fp2.isValid(x) || !Fp2.isValid(y))
        throw new Error("invalid affine point");
      if (p instanceof Point2)
        throw new Error("projective point not allowed");
      const is0 = (i) => Fp2.eql(i, Fp2.ZERO);
      if (is0(x) && is0(y))
        return Point2.ZERO;
      return new Point2(x, y, Fp2.ONE);
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     * Takes a bunch of Projective Points but executes only one
     * inversion on all of them. Inversion is very slow operation,
     * so this improves performance massively.
     * Optimization: converts a list of projective points to a list of identical points with Z=1.
     */
    static normalizeZ(points) {
      const toInv = Fp2.invertBatch(points.map((p) => p.pz));
      return points.map((p, i) => p.toAffine(toInv[i])).map(Point2.fromAffine);
    }
    /**
     * Converts hash string or Uint8Array to Point.
     * @param hex short/long ECDSA hex
     */
    static fromHex(hex) {
      const P = Point2.fromAffine(fromBytes(ensureBytes("pointHex", hex)));
      P.assertValidity();
      return P;
    }
    // Multiplies generator point by privateKey.
    static fromPrivateKey(privateKey) {
      return Point2.BASE.multiply(normPrivateKeyToScalar(privateKey));
    }
    // "Private method", don't use it directly
    _setWindowSize(windowSize) {
      this._WINDOW_SIZE = windowSize;
      pointPrecomputes.delete(this);
    }
    // A point on curve is valid if it conforms to equation.
    assertValidity() {
      if (this.is0()) {
        if (CURVE.allowInfinityPoint && !Fp2.is0(this.py))
          return;
        throw new Error("bad point: ZERO");
      }
      const { x, y } = this.toAffine();
      if (!Fp2.isValid(x) || !Fp2.isValid(y))
        throw new Error("bad point: x or y not FE");
      const left = Fp2.sqr(y);
      const right = weierstrassEquation(x);
      if (!Fp2.eql(left, right))
        throw new Error("bad point: equation left != right");
      if (!this.isTorsionFree())
        throw new Error("bad point: not in prime-order subgroup");
    }
    hasEvenY() {
      const { y } = this.toAffine();
      if (Fp2.isOdd)
        return !Fp2.isOdd(y);
      throw new Error("Field doesn't support isOdd");
    }
    /**
     * Compare one point to another.
     */
    equals(other) {
      assertPrjPoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      const U12 = Fp2.eql(Fp2.mul(X1, Z2), Fp2.mul(X2, Z1));
      const U22 = Fp2.eql(Fp2.mul(Y1, Z2), Fp2.mul(Y2, Z1));
      return U12 && U22;
    }
    /**
     * Flips point to one corresponding to (x, -y) in Affine coordinates.
     */
    negate() {
      return new Point2(this.px, Fp2.neg(this.py), this.pz);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a, b: b2 } = CURVE;
      const b3 = Fp2.mul(b2, _3n2);
      const { px: X1, py: Y1, pz: Z1 } = this;
      let X3 = Fp2.ZERO, Y3 = Fp2.ZERO, Z3 = Fp2.ZERO;
      let t0 = Fp2.mul(X1, X1);
      let t1 = Fp2.mul(Y1, Y1);
      let t2 = Fp2.mul(Z1, Z1);
      let t3 = Fp2.mul(X1, Y1);
      t3 = Fp2.add(t3, t3);
      Z3 = Fp2.mul(X1, Z1);
      Z3 = Fp2.add(Z3, Z3);
      X3 = Fp2.mul(a, Z3);
      Y3 = Fp2.mul(b3, t2);
      Y3 = Fp2.add(X3, Y3);
      X3 = Fp2.sub(t1, Y3);
      Y3 = Fp2.add(t1, Y3);
      Y3 = Fp2.mul(X3, Y3);
      X3 = Fp2.mul(t3, X3);
      Z3 = Fp2.mul(b3, Z3);
      t2 = Fp2.mul(a, t2);
      t3 = Fp2.sub(t0, t2);
      t3 = Fp2.mul(a, t3);
      t3 = Fp2.add(t3, Z3);
      Z3 = Fp2.add(t0, t0);
      t0 = Fp2.add(Z3, t0);
      t0 = Fp2.add(t0, t2);
      t0 = Fp2.mul(t0, t3);
      Y3 = Fp2.add(Y3, t0);
      t2 = Fp2.mul(Y1, Z1);
      t2 = Fp2.add(t2, t2);
      t0 = Fp2.mul(t2, t3);
      X3 = Fp2.sub(X3, t0);
      Z3 = Fp2.mul(t2, t1);
      Z3 = Fp2.add(Z3, Z3);
      Z3 = Fp2.add(Z3, Z3);
      return new Point2(X3, Y3, Z3);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(other) {
      assertPrjPoint(other);
      const { px: X1, py: Y1, pz: Z1 } = this;
      const { px: X2, py: Y2, pz: Z2 } = other;
      let X3 = Fp2.ZERO, Y3 = Fp2.ZERO, Z3 = Fp2.ZERO;
      const a = CURVE.a;
      const b3 = Fp2.mul(CURVE.b, _3n2);
      let t0 = Fp2.mul(X1, X2);
      let t1 = Fp2.mul(Y1, Y2);
      let t2 = Fp2.mul(Z1, Z2);
      let t3 = Fp2.add(X1, Y1);
      let t4 = Fp2.add(X2, Y2);
      t3 = Fp2.mul(t3, t4);
      t4 = Fp2.add(t0, t1);
      t3 = Fp2.sub(t3, t4);
      t4 = Fp2.add(X1, Z1);
      let t5 = Fp2.add(X2, Z2);
      t4 = Fp2.mul(t4, t5);
      t5 = Fp2.add(t0, t2);
      t4 = Fp2.sub(t4, t5);
      t5 = Fp2.add(Y1, Z1);
      X3 = Fp2.add(Y2, Z2);
      t5 = Fp2.mul(t5, X3);
      X3 = Fp2.add(t1, t2);
      t5 = Fp2.sub(t5, X3);
      Z3 = Fp2.mul(a, t4);
      X3 = Fp2.mul(b3, t2);
      Z3 = Fp2.add(X3, Z3);
      X3 = Fp2.sub(t1, Z3);
      Z3 = Fp2.add(t1, Z3);
      Y3 = Fp2.mul(X3, Z3);
      t1 = Fp2.add(t0, t0);
      t1 = Fp2.add(t1, t0);
      t2 = Fp2.mul(a, t2);
      t4 = Fp2.mul(b3, t4);
      t1 = Fp2.add(t1, t2);
      t2 = Fp2.sub(t0, t2);
      t2 = Fp2.mul(a, t2);
      t4 = Fp2.add(t4, t2);
      t0 = Fp2.mul(t1, t4);
      Y3 = Fp2.add(Y3, t0);
      t0 = Fp2.mul(t5, t4);
      X3 = Fp2.mul(t3, X3);
      X3 = Fp2.sub(X3, t0);
      t0 = Fp2.mul(t3, t1);
      Z3 = Fp2.mul(t5, Z3);
      Z3 = Fp2.add(Z3, t0);
      return new Point2(X3, Y3, Z3);
    }
    subtract(other) {
      return this.add(other.negate());
    }
    is0() {
      return this.equals(Point2.ZERO);
    }
    wNAF(n2) {
      return wnaf.wNAFCached(this, pointPrecomputes, n2, (comp) => {
        const toInv = Fp2.invertBatch(comp.map((p) => p.pz));
        return comp.map((p, i) => p.toAffine(toInv[i])).map(Point2.fromAffine);
      });
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed private key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(n2) {
      const I = Point2.ZERO;
      if (n2 === _0n5)
        return I;
      assertGE(n2);
      if (n2 === _1n5)
        return this;
      const { endo } = CURVE;
      if (!endo)
        return wnaf.unsafeLadder(this, n2);
      let { k1neg, k1, k2neg, k2 } = endo.splitScalar(n2);
      let k1p = I;
      let k2p = I;
      let d = this;
      while (k1 > _0n5 || k2 > _0n5) {
        if (k1 & _1n5)
          k1p = k1p.add(d);
        if (k2 & _1n5)
          k2p = k2p.add(d);
        d = d.double();
        k1 >>= _1n5;
        k2 >>= _1n5;
      }
      if (k1neg)
        k1p = k1p.negate();
      if (k2neg)
        k2p = k2p.negate();
      k2p = new Point2(Fp2.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
      return k1p.add(k2p);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(scalar) {
      assertGE(scalar);
      let n2 = scalar;
      let point, fake;
      const { endo } = CURVE;
      if (endo) {
        const { k1neg, k1, k2neg, k2 } = endo.splitScalar(n2);
        let { p: k1p, f: f1p } = this.wNAF(k1);
        let { p: k2p, f: f2p } = this.wNAF(k2);
        k1p = wnaf.constTimeNegate(k1neg, k1p);
        k2p = wnaf.constTimeNegate(k2neg, k2p);
        k2p = new Point2(Fp2.mul(k2p.px, endo.beta), k2p.py, k2p.pz);
        point = k1p.add(k2p);
        fake = f1p.add(f2p);
      } else {
        const { p, f: f2 } = this.wNAF(n2);
        point = p;
        fake = f2;
      }
      return Point2.normalizeZ([point, fake])[0];
    }
    /**
     * Efficiently calculate `aP + bQ`. Unsafe, can expose private key, if used incorrectly.
     * Not using Strauss-Shamir trick: precomputation tables are faster.
     * The trick could be useful if both P and Q are not G (not in our case).
     * @returns non-zero affine point
     */
    multiplyAndAddUnsafe(Q, a, b2) {
      const G = Point2.BASE;
      const mul = (P, a2) => a2 === _0n5 || a2 === _1n5 || !P.equals(G) ? P.multiplyUnsafe(a2) : P.multiply(a2);
      const sum = mul(this, a).add(mul(Q, b2));
      return sum.is0() ? void 0 : sum;
    }
    // Converts Projective point to affine (x, y) coordinates.
    // Can accept precomputed Z^-1 - for example, from invertBatch.
    // (x, y, z) ∋ (x=x/z, y=y/z)
    toAffine(iz) {
      const { px: x, py: y, pz: z } = this;
      const is0 = this.is0();
      if (iz == null)
        iz = is0 ? Fp2.ONE : Fp2.inv(z);
      const ax = Fp2.mul(x, iz);
      const ay = Fp2.mul(y, iz);
      const zz = Fp2.mul(z, iz);
      if (is0)
        return { x: Fp2.ZERO, y: Fp2.ZERO };
      if (!Fp2.eql(zz, Fp2.ONE))
        throw new Error("invZ was invalid");
      return { x: ax, y: ay };
    }
    isTorsionFree() {
      const { h: cofactor, isTorsionFree } = CURVE;
      if (cofactor === _1n5)
        return true;
      if (isTorsionFree)
        return isTorsionFree(Point2, this);
      throw new Error("isTorsionFree() has not been declared for the elliptic curve");
    }
    clearCofactor() {
      const { h: cofactor, clearCofactor } = CURVE;
      if (cofactor === _1n5)
        return this;
      if (clearCofactor)
        return clearCofactor(Point2, this);
      return this.multiplyUnsafe(CURVE.h);
    }
    toRawBytes(isCompressed = true) {
      this.assertValidity();
      return toBytes2(Point2, this, isCompressed);
    }
    toHex(isCompressed = true) {
      return bytesToHex(this.toRawBytes(isCompressed));
    }
  }
  Point2.BASE = new Point2(CURVE.Gx, CURVE.Gy, Fp2.ONE);
  Point2.ZERO = new Point2(Fp2.ZERO, Fp2.ONE, Fp2.ZERO);
  const _bits = CURVE.nBitLength;
  const wnaf = wNAF(Point2, CURVE.endo ? Math.ceil(_bits / 2) : _bits);
  return {
    CURVE,
    ProjectivePoint: Point2,
    normPrivateKeyToScalar,
    weierstrassEquation,
    isWithinCurveOrder
  };
}
function validateOpts(curve) {
  const opts = validateBasic(curve);
  validateObject(opts, {
    hash: "hash",
    hmac: "function",
    randomBytes: "function"
  }, {
    bits2int: "function",
    bits2int_modN: "function",
    lowS: "boolean"
  });
  return Object.freeze({ lowS: true, ...opts });
}
function weierstrass(curveDef) {
  const CURVE = validateOpts(curveDef);
  const { Fp: Fp2, n: CURVE_ORDER } = CURVE;
  const compressedLen = Fp2.BYTES + 1;
  const uncompressedLen = 2 * Fp2.BYTES + 1;
  function isValidFieldElement(num) {
    return _0n5 < num && num < Fp2.ORDER;
  }
  function modN(a) {
    return mod(a, CURVE_ORDER);
  }
  function invN(a) {
    return invert(a, CURVE_ORDER);
  }
  const { ProjectivePoint: Point2, normPrivateKeyToScalar, weierstrassEquation, isWithinCurveOrder } = weierstrassPoints({
    ...CURVE,
    toBytes(_c, point, isCompressed) {
      const a = point.toAffine();
      const x = Fp2.toBytes(a.x);
      const cat = concatBytes2;
      if (isCompressed) {
        return cat(Uint8Array.from([point.hasEvenY() ? 2 : 3]), x);
      } else {
        return cat(Uint8Array.from([4]), x, Fp2.toBytes(a.y));
      }
    },
    fromBytes(bytes2) {
      const len = bytes2.length;
      const head = bytes2[0];
      const tail = bytes2.subarray(1);
      if (len === compressedLen && (head === 2 || head === 3)) {
        const x = bytesToNumberBE(tail);
        if (!isValidFieldElement(x))
          throw new Error("Point is not on curve");
        const y2 = weierstrassEquation(x);
        let y = Fp2.sqrt(y2);
        const isYOdd = (y & _1n5) === _1n5;
        const isHeadOdd = (head & 1) === 1;
        if (isHeadOdd !== isYOdd)
          y = Fp2.neg(y);
        return { x, y };
      } else if (len === uncompressedLen && head === 4) {
        const x = Fp2.fromBytes(tail.subarray(0, Fp2.BYTES));
        const y = Fp2.fromBytes(tail.subarray(Fp2.BYTES, 2 * Fp2.BYTES));
        return { x, y };
      } else {
        throw new Error(`Point of length ${len} was invalid. Expected ${compressedLen} compressed bytes or ${uncompressedLen} uncompressed bytes`);
      }
    }
  });
  const numToNByteStr = (num) => bytesToHex(numberToBytesBE(num, CURVE.nByteLength));
  function isBiggerThanHalfOrder(number2) {
    const HALF = CURVE_ORDER >> _1n5;
    return number2 > HALF;
  }
  function normalizeS(s) {
    return isBiggerThanHalfOrder(s) ? modN(-s) : s;
  }
  const slcNum = (b2, from, to) => bytesToNumberBE(b2.slice(from, to));
  class Signature2 {
    constructor(r, s, recovery) {
      this.r = r;
      this.s = s;
      this.recovery = recovery;
      this.assertValidity();
    }
    // pair (bytes of r, bytes of s)
    static fromCompact(hex) {
      const l = CURVE.nByteLength;
      hex = ensureBytes("compactSignature", hex, l * 2);
      return new Signature2(slcNum(hex, 0, l), slcNum(hex, l, 2 * l));
    }
    // DER encoded ECDSA signature
    // https://bitcoin.stackexchange.com/questions/57644/what-are-the-parts-of-a-bitcoin-transaction-input-script
    static fromDER(hex) {
      const { r, s } = DER.toSig(ensureBytes("DER", hex));
      return new Signature2(r, s);
    }
    assertValidity() {
      if (!isWithinCurveOrder(this.r))
        throw new Error("r must be 0 < r < CURVE.n");
      if (!isWithinCurveOrder(this.s))
        throw new Error("s must be 0 < s < CURVE.n");
    }
    addRecoveryBit(recovery) {
      return new Signature2(this.r, this.s, recovery);
    }
    recoverPublicKey(msgHash) {
      const { r, s, recovery: rec } = this;
      const h = bits2int_modN(ensureBytes("msgHash", msgHash));
      if (rec == null || ![0, 1, 2, 3].includes(rec))
        throw new Error("recovery id invalid");
      const radj = rec === 2 || rec === 3 ? r + CURVE.n : r;
      if (radj >= Fp2.ORDER)
        throw new Error("recovery id 2 or 3 invalid");
      const prefix = (rec & 1) === 0 ? "02" : "03";
      const R = Point2.fromHex(prefix + numToNByteStr(radj));
      const ir = invN(radj);
      const u1 = modN(-h * ir);
      const u2 = modN(s * ir);
      const Q = Point2.BASE.multiplyAndAddUnsafe(R, u1, u2);
      if (!Q)
        throw new Error("point at infinify");
      Q.assertValidity();
      return Q;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return isBiggerThanHalfOrder(this.s);
    }
    normalizeS() {
      return this.hasHighS() ? new Signature2(this.r, modN(-this.s), this.recovery) : this;
    }
    // DER-encoded
    toDERRawBytes() {
      return hexToBytes(this.toDERHex());
    }
    toDERHex() {
      return DER.hexFromSig({ r: this.r, s: this.s });
    }
    // padded bytes of r, then padded bytes of s
    toCompactRawBytes() {
      return hexToBytes(this.toCompactHex());
    }
    toCompactHex() {
      return numToNByteStr(this.r) + numToNByteStr(this.s);
    }
  }
  const utils = {
    isValidPrivateKey(privateKey) {
      try {
        normPrivateKeyToScalar(privateKey);
        return true;
      } catch (error) {
        return false;
      }
    },
    normPrivateKeyToScalar,
    /**
     * Produces cryptographically secure private key from random of size
     * (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
     */
    randomPrivateKey: () => {
      const length = getMinHashLength(CURVE.n);
      return mapHashToField(CURVE.randomBytes(length), CURVE.n);
    },
    /**
     * Creates precompute table for an arbitrary EC point. Makes point "cached".
     * Allows to massively speed-up `point.multiply(scalar)`.
     * @returns cached point
     * @example
     * const fast = utils.precompute(8, ProjectivePoint.fromHex(someonesPubKey));
     * fast.multiply(privKey); // much faster ECDH now
     */
    precompute(windowSize = 8, point = Point2.BASE) {
      point._setWindowSize(windowSize);
      point.multiply(BigInt(3));
      return point;
    }
  };
  function getPublicKey(privateKey, isCompressed = true) {
    return Point2.fromPrivateKey(privateKey).toRawBytes(isCompressed);
  }
  function isProbPub(item) {
    const arr = item instanceof Uint8Array;
    const str = typeof item === "string";
    const len = (arr || str) && item.length;
    if (arr)
      return len === compressedLen || len === uncompressedLen;
    if (str)
      return len === 2 * compressedLen || len === 2 * uncompressedLen;
    if (item instanceof Point2)
      return true;
    return false;
  }
  function getSharedSecret(privateA, publicB, isCompressed = true) {
    if (isProbPub(privateA))
      throw new Error("first arg must be private key");
    if (!isProbPub(publicB))
      throw new Error("second arg must be public key");
    const b2 = Point2.fromHex(publicB);
    return b2.multiply(normPrivateKeyToScalar(privateA)).toRawBytes(isCompressed);
  }
  const bits2int = CURVE.bits2int || function(bytes2) {
    const num = bytesToNumberBE(bytes2);
    const delta = bytes2.length * 8 - CURVE.nBitLength;
    return delta > 0 ? num >> BigInt(delta) : num;
  };
  const bits2int_modN = CURVE.bits2int_modN || function(bytes2) {
    return modN(bits2int(bytes2));
  };
  const ORDER_MASK = bitMask(CURVE.nBitLength);
  function int2octets(num) {
    if (typeof num !== "bigint")
      throw new Error("bigint expected");
    if (!(_0n5 <= num && num < ORDER_MASK))
      throw new Error(`bigint expected < 2^${CURVE.nBitLength}`);
    return numberToBytesBE(num, CURVE.nByteLength);
  }
  function prepSig(msgHash, privateKey, opts = defaultSigOpts) {
    if (["recovered", "canonical"].some((k) => k in opts))
      throw new Error("sign() legacy options not supported");
    const { hash: hash2, randomBytes: randomBytes5 } = CURVE;
    let { lowS, prehash, extraEntropy: ent } = opts;
    if (lowS == null)
      lowS = true;
    msgHash = ensureBytes("msgHash", msgHash);
    if (prehash)
      msgHash = ensureBytes("prehashed msgHash", hash2(msgHash));
    const h1int = bits2int_modN(msgHash);
    const d = normPrivateKeyToScalar(privateKey);
    const seedArgs = [int2octets(d), int2octets(h1int)];
    if (ent != null) {
      const e = ent === true ? randomBytes5(Fp2.BYTES) : ent;
      seedArgs.push(ensureBytes("extraEntropy", e));
    }
    const seed = concatBytes2(...seedArgs);
    const m = h1int;
    function k2sig(kBytes) {
      const k = bits2int(kBytes);
      if (!isWithinCurveOrder(k))
        return;
      const ik = invN(k);
      const q = Point2.BASE.multiply(k).toAffine();
      const r = modN(q.x);
      if (r === _0n5)
        return;
      const s = modN(ik * modN(m + r * d));
      if (s === _0n5)
        return;
      let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n5);
      let normS = s;
      if (lowS && isBiggerThanHalfOrder(s)) {
        normS = normalizeS(s);
        recovery ^= 1;
      }
      return new Signature2(r, normS, recovery);
    }
    return { seed, k2sig };
  }
  const defaultSigOpts = { lowS: CURVE.lowS, prehash: false };
  const defaultVerOpts = { lowS: CURVE.lowS, prehash: false };
  function sign(msgHash, privKey, opts = defaultSigOpts) {
    const { seed, k2sig } = prepSig(msgHash, privKey, opts);
    const C = CURVE;
    const drbg = createHmacDrbg(C.hash.outputLen, C.nByteLength, C.hmac);
    return drbg(seed, k2sig);
  }
  Point2.BASE._setWindowSize(8);
  function verify(signature, msgHash, publicKey, opts = defaultVerOpts) {
    const sg = signature;
    msgHash = ensureBytes("msgHash", msgHash);
    publicKey = ensureBytes("publicKey", publicKey);
    if ("strict" in opts)
      throw new Error("options.strict was renamed to lowS");
    const { lowS, prehash } = opts;
    let _sig = void 0;
    let P;
    try {
      if (typeof sg === "string" || sg instanceof Uint8Array) {
        try {
          _sig = Signature2.fromDER(sg);
        } catch (derError) {
          if (!(derError instanceof DER.Err))
            throw derError;
          _sig = Signature2.fromCompact(sg);
        }
      } else if (typeof sg === "object" && typeof sg.r === "bigint" && typeof sg.s === "bigint") {
        const { r: r2, s: s2 } = sg;
        _sig = new Signature2(r2, s2);
      } else {
        throw new Error("PARSE");
      }
      P = Point2.fromHex(publicKey);
    } catch (error) {
      if (error.message === "PARSE")
        throw new Error(`signature must be Signature instance, Uint8Array or hex string`);
      return false;
    }
    if (lowS && _sig.hasHighS())
      return false;
    if (prehash)
      msgHash = CURVE.hash(msgHash);
    const { r, s } = _sig;
    const h = bits2int_modN(msgHash);
    const is = invN(s);
    const u1 = modN(h * is);
    const u2 = modN(r * is);
    const R = Point2.BASE.multiplyAndAddUnsafe(P, u1, u2)?.toAffine();
    if (!R)
      return false;
    const v = modN(R.x);
    return v === r;
  }
  return {
    CURVE,
    getPublicKey,
    getSharedSecret,
    sign,
    verify,
    ProjectivePoint: Point2,
    Signature: Signature2,
    utils
  };
}

// node_modules/@noble/curves/esm/_shortw_utils.js
function getHash(hash2) {
  return {
    hash: hash2,
    hmac: (key, ...msgs) => hmac(hash2, key, concatBytes(...msgs)),
    randomBytes: randomBytes2
  };
}
function createCurve(curveDef, defHash) {
  const create = (hash2) => weierstrass({ ...curveDef, ...getHash(hash2) });
  return Object.freeze({ ...create(defHash), create });
}

// node_modules/@noble/curves/esm/secp256k1.js
var secp256k1P = BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f");
var secp256k1N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
var _1n6 = BigInt(1);
var _2n5 = BigInt(2);
var divNearest = (a, b2) => (a + b2 / _2n5) / b2;
function sqrtMod(y) {
  const P = secp256k1P;
  const _3n3 = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
  const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
  const b2 = y * y * y % P;
  const b3 = b2 * b2 * y % P;
  const b6 = pow2(b3, _3n3, P) * b3 % P;
  const b9 = pow2(b6, _3n3, P) * b3 % P;
  const b11 = pow2(b9, _2n5, P) * b2 % P;
  const b22 = pow2(b11, _11n, P) * b11 % P;
  const b44 = pow2(b22, _22n, P) * b22 % P;
  const b88 = pow2(b44, _44n, P) * b44 % P;
  const b176 = pow2(b88, _88n, P) * b88 % P;
  const b220 = pow2(b176, _44n, P) * b44 % P;
  const b223 = pow2(b220, _3n3, P) * b3 % P;
  const t1 = pow2(b223, _23n, P) * b22 % P;
  const t2 = pow2(t1, _6n, P) * b2 % P;
  const root = pow2(t2, _2n5, P);
  if (!Fp.eql(Fp.sqr(root), y))
    throw new Error("Cannot find square root");
  return root;
}
var Fp = Field(secp256k1P, void 0, void 0, { sqrt: sqrtMod });
var secp256k1 = createCurve({
  a: BigInt(0),
  b: BigInt(7),
  Fp,
  n: secp256k1N,
  // Base point (x, y) aka generator point
  Gx: BigInt("55066263022277343669578718895168534326250603453777594175500187360389116729240"),
  Gy: BigInt("32670510020758816978083085130507043184471273380659243275938904335757337482424"),
  h: BigInt(1),
  lowS: true,
  /**
   * secp256k1 belongs to Koblitz curves: it has efficiently computable endomorphism.
   * Endomorphism uses 2x less RAM, speeds up precomputation by 2x and ECDH / key recovery by 20%.
   * For precomputed wNAF it trades off 1/2 init time & 1/3 ram for 20% perf hit.
   * Explanation: https://gist.github.com/paulmillr/eb670806793e84df628a7c434a873066
   */
  endo: {
    beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
    splitScalar: (k) => {
      const n2 = secp256k1N;
      const a1 = BigInt("0x3086d221a7d46bcde86c90e49284eb15");
      const b1 = -_1n6 * BigInt("0xe4437ed6010e88286f547fa90abfe4c3");
      const a2 = BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8");
      const b2 = a1;
      const POW_2_128 = BigInt("0x100000000000000000000000000000000");
      const c1 = divNearest(b2 * k, n2);
      const c2 = divNearest(-b1 * k, n2);
      let k1 = mod(k - c1 * a1 - c2 * a2, n2);
      let k2 = mod(-c1 * b1 - c2 * b2, n2);
      const k1neg = k1 > POW_2_128;
      const k2neg = k2 > POW_2_128;
      if (k1neg)
        k1 = n2 - k1;
      if (k2neg)
        k2 = n2 - k2;
      if (k1 > POW_2_128 || k2 > POW_2_128) {
        throw new Error("splitScalar: Endomorphism failed, k=" + k);
      }
      return { k1neg, k1, k2neg, k2 };
    }
  }
}, sha256);
var _0n6 = BigInt(0);
var Point = secp256k1.ProjectivePoint;

// node_modules/ethers/lib.esm/constants/addresses.js
var ZeroAddress = "0x0000000000000000000000000000000000000000";

// node_modules/ethers/lib.esm/constants/hashes.js
var ZeroHash = "0x0000000000000000000000000000000000000000000000000000000000000000";

// node_modules/ethers/lib.esm/constants/strings.js
var MessagePrefix = "Ethereum Signed Message:\n";

// node_modules/ethers/lib.esm/crypto/signature.js
var BN_04 = BigInt(0);
var BN_13 = BigInt(1);
var BN_2 = BigInt(2);
var BN_27 = BigInt(27);
var BN_28 = BigInt(28);
var BN_35 = BigInt(35);
var BN_N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
var BN_N_2 = BN_N / BN_2;
var inspect = Symbol.for("nodejs.util.inspect.custom");
var _guard3 = {};
function toUint256(value) {
  return zeroPadValue(toBeArray(value), 32);
}
var Signature = class _Signature {
  #r;
  #s;
  #v;
  #networkV;
  /**
   *  The ``r`` value for a signature.
   *
   *  This represents the ``x`` coordinate of a "reference" or
   *  challenge point, from which the ``y`` can be computed.
   */
  get r() {
    return this.#r;
  }
  set r(value) {
    assertArgument(dataLength(value) === 32, "invalid r", "value", value);
    this.#r = hexlify(value);
  }
  /**
   *  The ``s`` value for a signature.
   */
  get s() {
    assertArgument(parseInt(this.#s.substring(0, 3)) < 8, "non-canonical s; use ._s", "s", this.#s);
    return this.#s;
  }
  set s(_value) {
    assertArgument(dataLength(_value) === 32, "invalid s", "value", _value);
    this.#s = hexlify(_value);
  }
  /**
   *  Return the s value, unchecked for EIP-2 compliance.
   *
   *  This should generally not be used and is for situations where
   *  a non-canonical S value might be relevant, such as Frontier blocks
   *  that were mined prior to EIP-2 or invalid Authorization List
   *  signatures.
   */
  get _s() {
    return this.#s;
  }
  /**
   *  Returns true if the Signature is valid for [[link-eip-2]] signatures.
   */
  isValid() {
    const s = BigInt(this.#s);
    return s <= BN_N_2;
  }
  /**
   *  The ``v`` value for a signature.
   *
   *  Since a given ``x`` value for ``r`` has two possible values for
   *  its correspondin ``y``, the ``v`` indicates which of the two ``y``
   *  values to use.
   *
   *  It is normalized to the values ``27`` or ``28`` for legacy
   *  purposes.
   */
  get v() {
    return this.#v;
  }
  set v(value) {
    const v = getNumber(value, "value");
    assertArgument(v === 27 || v === 28, "invalid v", "v", value);
    this.#v = v;
  }
  /**
   *  The EIP-155 ``v`` for legacy transactions. For non-legacy
   *  transactions, this value is ``null``.
   */
  get networkV() {
    return this.#networkV;
  }
  /**
   *  The chain ID for EIP-155 legacy transactions. For non-legacy
   *  transactions, this value is ``null``.
   */
  get legacyChainId() {
    const v = this.networkV;
    if (v == null) {
      return null;
    }
    return _Signature.getChainId(v);
  }
  /**
   *  The ``yParity`` for the signature.
   *
   *  See ``v`` for more details on how this value is used.
   */
  get yParity() {
    return this.v === 27 ? 0 : 1;
  }
  /**
   *  The [[link-eip-2098]] compact representation of the ``yParity``
   *  and ``s`` compacted into a single ``bytes32``.
   */
  get yParityAndS() {
    const yParityAndS = getBytes(this.s);
    if (this.yParity) {
      yParityAndS[0] |= 128;
    }
    return hexlify(yParityAndS);
  }
  /**
   *  The [[link-eip-2098]] compact representation.
   */
  get compactSerialized() {
    return concat([this.r, this.yParityAndS]);
  }
  /**
   *  The serialized representation.
   */
  get serialized() {
    return concat([this.r, this.s, this.yParity ? "0x1c" : "0x1b"]);
  }
  /**
   *  @private
   */
  constructor(guard, r, s, v) {
    assertPrivate(guard, _guard3, "Signature");
    this.#r = r;
    this.#s = s;
    this.#v = v;
    this.#networkV = null;
  }
  /**
   *  Returns the canonical signature.
   *
   *  This is only necessary when dealing with legacy transaction which
   *  did not enforce canonical S values (i.e. [[link-eip-2]]. Most
   *  developers should never require this.
   */
  getCanonical() {
    if (this.isValid()) {
      return this;
    }
    const s = BN_N - BigInt(this._s);
    const v = 55 - this.v;
    const result2 = new _Signature(_guard3, this.r, toUint256(s), v);
    if (this.networkV) {
      result2.#networkV = this.networkV;
    }
    return result2;
  }
  /**
   *  Returns a new identical [[Signature]].
   */
  clone() {
    const clone = new _Signature(_guard3, this.r, this._s, this.v);
    if (this.networkV) {
      clone.#networkV = this.networkV;
    }
    return clone;
  }
  /**
   *  Returns a representation that is compatible with ``JSON.stringify``.
   */
  toJSON() {
    const networkV = this.networkV;
    return {
      _type: "signature",
      networkV: networkV != null ? networkV.toString() : null,
      r: this.r,
      s: this._s,
      v: this.v
    };
  }
  [inspect]() {
    return this.toString();
  }
  toString() {
    if (this.isValid()) {
      return `Signature { r: ${this.r}, s: ${this._s}, v: ${this.v} }`;
    }
    return `Signature { r: ${this.r}, s: ${this._s}, v: ${this.v}, valid: false }`;
  }
  /**
   *  Compute the chain ID from the ``v`` in a legacy EIP-155 transactions.
   *
   *  @example:
   *    Signature.getChainId(45)
   *    //_result:
   *
   *    Signature.getChainId(46)
   *    //_result:
   */
  static getChainId(v) {
    const bv = getBigInt(v, "v");
    if (bv == BN_27 || bv == BN_28) {
      return BN_04;
    }
    assertArgument(bv >= BN_35, "invalid EIP-155 v", "v", v);
    return (bv - BN_35) / BN_2;
  }
  /**
   *  Compute the ``v`` for a chain ID for a legacy EIP-155 transactions.
   *
   *  Legacy transactions which use [[link-eip-155]] hijack the ``v``
   *  property to include the chain ID.
   *
   *  @example:
   *    Signature.getChainIdV(5, 27)
   *    //_result:
   *
   *    Signature.getChainIdV(5, 28)
   *    //_result:
   *
   */
  static getChainIdV(chainId, v) {
    return getBigInt(chainId) * BN_2 + BigInt(35 + v - 27);
  }
  /**
   *  Compute the normalized legacy transaction ``v`` from a ``yParirty``,
   *  a legacy transaction ``v`` or a legacy [[link-eip-155]] transaction.
   *
   *  @example:
   *    // The values 0 and 1 imply v is actually yParity
   *    Signature.getNormalizedV(0)
   *    //_result:
   *
   *    // Legacy non-EIP-1559 transaction (i.e. 27 or 28)
   *    Signature.getNormalizedV(27)
   *    //_result:
   *
   *    // Legacy EIP-155 transaction (i.e. >= 35)
   *    Signature.getNormalizedV(46)
   *    //_result:
   *
   *    // Invalid values throw
   *    Signature.getNormalizedV(5)
   *    //_error:
   */
  static getNormalizedV(v) {
    const bv = getBigInt(v);
    if (bv === BN_04 || bv === BN_27) {
      return 27;
    }
    if (bv === BN_13 || bv === BN_28) {
      return 28;
    }
    assertArgument(bv >= BN_35, "invalid v", "v", v);
    return bv & BN_13 ? 27 : 28;
  }
  /**
   *  Creates a new [[Signature]].
   *
   *  If no %%sig%% is provided, a new [[Signature]] is created
   *  with default values.
   *
   *  If %%sig%% is a string, it is parsed.
   */
  static from(sig) {
    function assertError(check, message) {
      assertArgument(check, message, "signature", sig);
    }
    ;
    if (sig == null) {
      return new _Signature(_guard3, ZeroHash, ZeroHash, 27);
    }
    if (typeof sig === "string") {
      const bytes2 = getBytes(sig, "signature");
      if (bytes2.length === 64) {
        const r2 = hexlify(bytes2.slice(0, 32));
        const s2 = bytes2.slice(32, 64);
        const v2 = s2[0] & 128 ? 28 : 27;
        s2[0] &= 127;
        return new _Signature(_guard3, r2, hexlify(s2), v2);
      }
      if (bytes2.length === 65) {
        const r2 = hexlify(bytes2.slice(0, 32));
        const s2 = hexlify(bytes2.slice(32, 64));
        const v2 = _Signature.getNormalizedV(bytes2[64]);
        return new _Signature(_guard3, r2, s2, v2);
      }
      assertError(false, "invalid raw signature length");
    }
    if (sig instanceof _Signature) {
      return sig.clone();
    }
    const _r = sig.r;
    assertError(_r != null, "missing r");
    const r = toUint256(_r);
    const s = function(s2, yParityAndS) {
      if (s2 != null) {
        return toUint256(s2);
      }
      if (yParityAndS != null) {
        assertError(isHexString(yParityAndS, 32), "invalid yParityAndS");
        const bytes2 = getBytes(yParityAndS);
        bytes2[0] &= 127;
        return hexlify(bytes2);
      }
      assertError(false, "missing s");
    }(sig.s, sig.yParityAndS);
    const { networkV, v } = function(_v, yParityAndS, yParity) {
      if (_v != null) {
        const v2 = getBigInt(_v);
        return {
          networkV: v2 >= BN_35 ? v2 : void 0,
          v: _Signature.getNormalizedV(v2)
        };
      }
      if (yParityAndS != null) {
        assertError(isHexString(yParityAndS, 32), "invalid yParityAndS");
        return { v: getBytes(yParityAndS)[0] & 128 ? 28 : 27 };
      }
      if (yParity != null) {
        switch (getNumber(yParity, "sig.yParity")) {
          case 0:
            return { v: 27 };
          case 1:
            return { v: 28 };
        }
        assertError(false, "invalid yParity");
      }
      assertError(false, "missing v");
    }(sig.v, sig.yParityAndS, sig.yParity);
    const result2 = new _Signature(_guard3, r, s, v);
    if (networkV) {
      result2.#networkV = networkV;
    }
    assertError(sig.yParity == null || getNumber(sig.yParity, "sig.yParity") === result2.yParity, "yParity mismatch");
    assertError(sig.yParityAndS == null || sig.yParityAndS === result2.yParityAndS, "yParityAndS mismatch");
    return result2;
  }
};

// node_modules/ethers/lib.esm/crypto/signing-key.js
var SigningKey = class _SigningKey {
  #privateKey;
  /**
   *  Creates a new **SigningKey** for %%privateKey%%.
   */
  constructor(privateKey) {
    assertArgument(dataLength(privateKey) === 32, "invalid private key", "privateKey", "[REDACTED]");
    this.#privateKey = hexlify(privateKey);
  }
  /**
   *  The private key.
   */
  get privateKey() {
    return this.#privateKey;
  }
  /**
   *  The uncompressed public key.
   *
   * This will always begin with the prefix ``0x04`` and be 132
   * characters long (the ``0x`` prefix and 130 hexadecimal nibbles).
   */
  get publicKey() {
    return _SigningKey.computePublicKey(this.#privateKey);
  }
  /**
   *  The compressed public key.
   *
   *  This will always begin with either the prefix ``0x02`` or ``0x03``
   *  and be 68 characters long (the ``0x`` prefix and 33 hexadecimal
   *  nibbles)
   */
  get compressedPublicKey() {
    return _SigningKey.computePublicKey(this.#privateKey, true);
  }
  /**
   *  Return the signature of the signed %%digest%%.
   */
  sign(digest) {
    assertArgument(dataLength(digest) === 32, "invalid digest length", "digest", digest);
    const sig = secp256k1.sign(getBytesCopy(digest), getBytesCopy(this.#privateKey), {
      lowS: true
    });
    return Signature.from({
      r: toBeHex(sig.r, 32),
      s: toBeHex(sig.s, 32),
      v: sig.recovery ? 28 : 27
    });
  }
  /**
   *  Returns the [[link-wiki-ecdh]] shared secret between this
   *  private key and the %%other%% key.
   *
   *  The %%other%% key may be any type of key, a raw public key,
   *  a compressed/uncompressed pubic key or aprivate key.
   *
   *  Best practice is usually to use a cryptographic hash on the
   *  returned value before using it as a symetric secret.
   *
   *  @example:
   *    sign1 = new SigningKey(id("some-secret-1"))
   *    sign2 = new SigningKey(id("some-secret-2"))
   *
   *    // Notice that privA.computeSharedSecret(pubB)...
   *    sign1.computeSharedSecret(sign2.publicKey)
   *    //_result:
   *
   *    // ...is equal to privB.computeSharedSecret(pubA).
   *    sign2.computeSharedSecret(sign1.publicKey)
   *    //_result:
   */
  computeSharedSecret(other) {
    const pubKey = _SigningKey.computePublicKey(other);
    return hexlify(secp256k1.getSharedSecret(getBytesCopy(this.#privateKey), getBytes(pubKey), false));
  }
  /**
   *  Compute the public key for %%key%%, optionally %%compressed%%.
   *
   *  The %%key%% may be any type of key, a raw public key, a
   *  compressed/uncompressed public key or private key.
   *
   *  @example:
   *    sign = new SigningKey(id("some-secret"));
   *
   *    // Compute the uncompressed public key for a private key
   *    SigningKey.computePublicKey(sign.privateKey)
   *    //_result:
   *
   *    // Compute the compressed public key for a private key
   *    SigningKey.computePublicKey(sign.privateKey, true)
   *    //_result:
   *
   *    // Compute the uncompressed public key
   *    SigningKey.computePublicKey(sign.publicKey, false);
   *    //_result:
   *
   *    // Compute the Compressed a public key
   *    SigningKey.computePublicKey(sign.publicKey, true);
   *    //_result:
   */
  static computePublicKey(key, compressed) {
    let bytes2 = getBytes(key, "key");
    if (bytes2.length === 32) {
      const pubKey = secp256k1.getPublicKey(bytes2, !!compressed);
      return hexlify(pubKey);
    }
    if (bytes2.length === 64) {
      const pub = new Uint8Array(65);
      pub[0] = 4;
      pub.set(bytes2, 1);
      bytes2 = pub;
    }
    const point = secp256k1.ProjectivePoint.fromHex(bytes2);
    return hexlify(point.toRawBytes(compressed));
  }
  /**
   *  Returns the public key for the private key which produced the
   *  %%signature%% for the given %%digest%%.
   *
   *  @example:
   *    key = new SigningKey(id("some-secret"))
   *    digest = id("hello world")
   *    sig = key.sign(digest)
   *
   *    // Notice the signer public key...
   *    key.publicKey
   *    //_result:
   *
   *    // ...is equal to the recovered public key
   *    SigningKey.recoverPublicKey(digest, sig)
   *    //_result:
   *
   */
  static recoverPublicKey(digest, signature) {
    assertArgument(dataLength(digest) === 32, "invalid digest length", "digest", digest);
    const sig = Signature.from(signature);
    let secpSig = secp256k1.Signature.fromCompact(getBytesCopy(concat([sig.r, sig.s])));
    secpSig = secpSig.addRecoveryBit(sig.yParity);
    const pubKey = secpSig.recoverPublicKey(getBytesCopy(digest));
    assertArgument(pubKey != null, "invalid signature for digest", "signature", signature);
    return "0x" + pubKey.toHex(false);
  }
  /**
   *  Returns the point resulting from adding the ellipic curve points
   *  %%p0%% and %%p1%%.
   *
   *  This is not a common function most developers should require, but
   *  can be useful for certain privacy-specific techniques.
   *
   *  For example, it is used by [[HDNodeWallet]] to compute child
   *  addresses from parent public keys and chain codes.
   */
  static addPoints(p0, p1, compressed) {
    const pub0 = secp256k1.ProjectivePoint.fromHex(_SigningKey.computePublicKey(p0).substring(2));
    const pub1 = secp256k1.ProjectivePoint.fromHex(_SigningKey.computePublicKey(p1).substring(2));
    return "0x" + pub0.add(pub1).toHex(!!compressed);
  }
};

// node_modules/ethers/lib.esm/address/address.js
var BN_05 = BigInt(0);
var BN_36 = BigInt(36);
function getChecksumAddress(address) {
  address = address.toLowerCase();
  const chars = address.substring(2).split("");
  const expanded = new Uint8Array(40);
  for (let i = 0; i < 40; i++) {
    expanded[i] = chars[i].charCodeAt(0);
  }
  const hashed = getBytes(keccak256(expanded));
  for (let i = 0; i < 40; i += 2) {
    if (hashed[i >> 1] >> 4 >= 8) {
      chars[i] = chars[i].toUpperCase();
    }
    if ((hashed[i >> 1] & 15) >= 8) {
      chars[i + 1] = chars[i + 1].toUpperCase();
    }
  }
  return "0x" + chars.join("");
}
var ibanLookup = {};
for (let i = 0; i < 10; i++) {
  ibanLookup[String(i)] = String(i);
}
for (let i = 0; i < 26; i++) {
  ibanLookup[String.fromCharCode(65 + i)] = String(10 + i);
}
var safeDigits = 15;
function ibanChecksum(address) {
  address = address.toUpperCase();
  address = address.substring(4) + address.substring(0, 2) + "00";
  let expanded = address.split("").map((c) => {
    return ibanLookup[c];
  }).join("");
  while (expanded.length >= safeDigits) {
    let block = expanded.substring(0, safeDigits);
    expanded = parseInt(block, 10) % 97 + expanded.substring(block.length);
  }
  let checksum2 = String(98 - parseInt(expanded, 10) % 97);
  while (checksum2.length < 2) {
    checksum2 = "0" + checksum2;
  }
  return checksum2;
}
var Base36 = function() {
  ;
  const result2 = {};
  for (let i = 0; i < 36; i++) {
    const key = "0123456789abcdefghijklmnopqrstuvwxyz"[i];
    result2[key] = BigInt(i);
  }
  return result2;
}();
function fromBase36(value) {
  value = value.toLowerCase();
  let result2 = BN_05;
  for (let i = 0; i < value.length; i++) {
    result2 = result2 * BN_36 + Base36[value[i]];
  }
  return result2;
}
function getAddress(address) {
  assertArgument(typeof address === "string", "invalid address", "address", address);
  if (address.match(/^(0x)?[0-9a-fA-F]{40}$/)) {
    if (!address.startsWith("0x")) {
      address = "0x" + address;
    }
    const result2 = getChecksumAddress(address);
    assertArgument(!address.match(/([A-F].*[a-f])|([a-f].*[A-F])/) || result2 === address, "bad address checksum", "address", address);
    return result2;
  }
  if (address.match(/^XE[0-9]{2}[0-9A-Za-z]{30,31}$/)) {
    assertArgument(address.substring(2, 4) === ibanChecksum(address), "bad icap checksum", "address", address);
    let result2 = fromBase36(address.substring(4)).toString(16);
    while (result2.length < 40) {
      result2 = "0" + result2;
    }
    return getChecksumAddress("0x" + result2);
  }
  assertArgument(false, "invalid address", "address", address);
}

// node_modules/ethers/lib.esm/address/contract-address.js
function getCreateAddress(tx) {
  const from = getAddress(tx.from);
  const nonce = getBigInt(tx.nonce, "tx.nonce");
  let nonceHex = nonce.toString(16);
  if (nonceHex === "0") {
    nonceHex = "0x";
  } else if (nonceHex.length % 2) {
    nonceHex = "0x0" + nonceHex;
  } else {
    nonceHex = "0x" + nonceHex;
  }
  return getAddress(dataSlice(keccak256(encodeRlp([from, nonceHex])), 12));
}

// node_modules/ethers/lib.esm/address/checks.js
function isAddressable(value) {
  return value && typeof value.getAddress === "function";
}
function isAddress(value) {
  try {
    getAddress(value);
    return true;
  } catch (error) {
  }
  return false;
}
async function checkAddress(target, promise) {
  const result2 = await promise;
  if (result2 == null || result2 === "0x0000000000000000000000000000000000000000") {
    assert(typeof target !== "string", "unconfigured name", "UNCONFIGURED_NAME", { value: target });
    assertArgument(false, "invalid AddressLike value; did not resolve to a value address", "target", target);
  }
  return getAddress(result2);
}
function resolveAddress(target, resolver) {
  if (typeof target === "string") {
    if (target.match(/^0x[0-9a-f]{40}$/i)) {
      return getAddress(target);
    }
    assert(resolver != null, "ENS resolution requires a provider", "UNSUPPORTED_OPERATION", { operation: "resolveName" });
    return checkAddress(target, resolver.resolveName(target));
  } else if (isAddressable(target)) {
    return checkAddress(target, target.getAddress());
  } else if (target && typeof target.then === "function") {
    return checkAddress(target, target);
  }
  assertArgument(false, "unsupported addressable value", "target", target);
}

// node_modules/ethers/lib.esm/abi/typed.js
var _gaurd = {};
function n(value, width) {
  let signed2 = false;
  if (width < 0) {
    signed2 = true;
    width *= -1;
  }
  return new Typed(_gaurd, `${signed2 ? "" : "u"}int${width}`, value, { signed: signed2, width });
}
function b(value, size) {
  return new Typed(_gaurd, `bytes${size ? size : ""}`, value, { size });
}
var _typedSymbol = Symbol.for("_ethers_typed");
var Typed = class _Typed {
  /**
   *  The type, as a Solidity-compatible type.
   */
  type;
  /**
   *  The actual value.
   */
  value;
  #options;
  /**
   *  @_ignore:
   */
  _typedSymbol;
  /**
   *  @_ignore:
   */
  constructor(gaurd, type, value, options2) {
    if (options2 == null) {
      options2 = null;
    }
    assertPrivate(_gaurd, gaurd, "Typed");
    defineProperties(this, { _typedSymbol, type, value });
    this.#options = options2;
    this.format();
  }
  /**
   *  Format the type as a Human-Readable type.
   */
  format() {
    if (this.type === "array") {
      throw new Error("");
    } else if (this.type === "dynamicArray") {
      throw new Error("");
    } else if (this.type === "tuple") {
      return `tuple(${this.value.map((v) => v.format()).join(",")})`;
    }
    return this.type;
  }
  /**
   *  The default value returned by this type.
   */
  defaultValue() {
    return 0;
  }
  /**
   *  The minimum value for numeric types.
   */
  minValue() {
    return 0;
  }
  /**
   *  The maximum value for numeric types.
   */
  maxValue() {
    return 0;
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedBigInt]].
   */
  isBigInt() {
    return !!this.type.match(/^u?int[0-9]+$/);
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedData]].
   */
  isData() {
    return this.type.startsWith("bytes");
  }
  /**
   *  Returns ``true`` and provides a type guard is this is a [[TypedString]].
   */
  isString() {
    return this.type === "string";
  }
  /**
   *  Returns the tuple name, if this is a tuple. Throws otherwise.
   */
  get tupleName() {
    if (this.type !== "tuple") {
      throw TypeError("not a tuple");
    }
    return this.#options;
  }
  // Returns the length of this type as an array
  // - `null` indicates the length is unforced, it could be dynamic
  // - `-1` indicates the length is dynamic
  // - any other value indicates it is a static array and is its length
  /**
   *  Returns the length of the array type or ``-1`` if it is dynamic.
   *
   *  Throws if the type is not an array.
   */
  get arrayLength() {
    if (this.type !== "array") {
      throw TypeError("not an array");
    }
    if (this.#options === true) {
      return -1;
    }
    if (this.#options === false) {
      return this.value.length;
    }
    return null;
  }
  /**
   *  Returns a new **Typed** of %%type%% with the %%value%%.
   */
  static from(type, value) {
    return new _Typed(_gaurd, type, value);
  }
  /**
   *  Return a new ``uint8`` type for %%v%%.
   */
  static uint8(v) {
    return n(v, 8);
  }
  /**
   *  Return a new ``uint16`` type for %%v%%.
   */
  static uint16(v) {
    return n(v, 16);
  }
  /**
   *  Return a new ``uint24`` type for %%v%%.
   */
  static uint24(v) {
    return n(v, 24);
  }
  /**
   *  Return a new ``uint32`` type for %%v%%.
   */
  static uint32(v) {
    return n(v, 32);
  }
  /**
   *  Return a new ``uint40`` type for %%v%%.
   */
  static uint40(v) {
    return n(v, 40);
  }
  /**
   *  Return a new ``uint48`` type for %%v%%.
   */
  static uint48(v) {
    return n(v, 48);
  }
  /**
   *  Return a new ``uint56`` type for %%v%%.
   */
  static uint56(v) {
    return n(v, 56);
  }
  /**
   *  Return a new ``uint64`` type for %%v%%.
   */
  static uint64(v) {
    return n(v, 64);
  }
  /**
   *  Return a new ``uint72`` type for %%v%%.
   */
  static uint72(v) {
    return n(v, 72);
  }
  /**
   *  Return a new ``uint80`` type for %%v%%.
   */
  static uint80(v) {
    return n(v, 80);
  }
  /**
   *  Return a new ``uint88`` type for %%v%%.
   */
  static uint88(v) {
    return n(v, 88);
  }
  /**
   *  Return a new ``uint96`` type for %%v%%.
   */
  static uint96(v) {
    return n(v, 96);
  }
  /**
   *  Return a new ``uint104`` type for %%v%%.
   */
  static uint104(v) {
    return n(v, 104);
  }
  /**
   *  Return a new ``uint112`` type for %%v%%.
   */
  static uint112(v) {
    return n(v, 112);
  }
  /**
   *  Return a new ``uint120`` type for %%v%%.
   */
  static uint120(v) {
    return n(v, 120);
  }
  /**
   *  Return a new ``uint128`` type for %%v%%.
   */
  static uint128(v) {
    return n(v, 128);
  }
  /**
   *  Return a new ``uint136`` type for %%v%%.
   */
  static uint136(v) {
    return n(v, 136);
  }
  /**
   *  Return a new ``uint144`` type for %%v%%.
   */
  static uint144(v) {
    return n(v, 144);
  }
  /**
   *  Return a new ``uint152`` type for %%v%%.
   */
  static uint152(v) {
    return n(v, 152);
  }
  /**
   *  Return a new ``uint160`` type for %%v%%.
   */
  static uint160(v) {
    return n(v, 160);
  }
  /**
   *  Return a new ``uint168`` type for %%v%%.
   */
  static uint168(v) {
    return n(v, 168);
  }
  /**
   *  Return a new ``uint176`` type for %%v%%.
   */
  static uint176(v) {
    return n(v, 176);
  }
  /**
   *  Return a new ``uint184`` type for %%v%%.
   */
  static uint184(v) {
    return n(v, 184);
  }
  /**
   *  Return a new ``uint192`` type for %%v%%.
   */
  static uint192(v) {
    return n(v, 192);
  }
  /**
   *  Return a new ``uint200`` type for %%v%%.
   */
  static uint200(v) {
    return n(v, 200);
  }
  /**
   *  Return a new ``uint208`` type for %%v%%.
   */
  static uint208(v) {
    return n(v, 208);
  }
  /**
   *  Return a new ``uint216`` type for %%v%%.
   */
  static uint216(v) {
    return n(v, 216);
  }
  /**
   *  Return a new ``uint224`` type for %%v%%.
   */
  static uint224(v) {
    return n(v, 224);
  }
  /**
   *  Return a new ``uint232`` type for %%v%%.
   */
  static uint232(v) {
    return n(v, 232);
  }
  /**
   *  Return a new ``uint240`` type for %%v%%.
   */
  static uint240(v) {
    return n(v, 240);
  }
  /**
   *  Return a new ``uint248`` type for %%v%%.
   */
  static uint248(v) {
    return n(v, 248);
  }
  /**
   *  Return a new ``uint256`` type for %%v%%.
   */
  static uint256(v) {
    return n(v, 256);
  }
  /**
   *  Return a new ``uint256`` type for %%v%%.
   */
  static uint(v) {
    return n(v, 256);
  }
  /**
   *  Return a new ``int8`` type for %%v%%.
   */
  static int8(v) {
    return n(v, -8);
  }
  /**
   *  Return a new ``int16`` type for %%v%%.
   */
  static int16(v) {
    return n(v, -16);
  }
  /**
   *  Return a new ``int24`` type for %%v%%.
   */
  static int24(v) {
    return n(v, -24);
  }
  /**
   *  Return a new ``int32`` type for %%v%%.
   */
  static int32(v) {
    return n(v, -32);
  }
  /**
   *  Return a new ``int40`` type for %%v%%.
   */
  static int40(v) {
    return n(v, -40);
  }
  /**
   *  Return a new ``int48`` type for %%v%%.
   */
  static int48(v) {
    return n(v, -48);
  }
  /**
   *  Return a new ``int56`` type for %%v%%.
   */
  static int56(v) {
    return n(v, -56);
  }
  /**
   *  Return a new ``int64`` type for %%v%%.
   */
  static int64(v) {
    return n(v, -64);
  }
  /**
   *  Return a new ``int72`` type for %%v%%.
   */
  static int72(v) {
    return n(v, -72);
  }
  /**
   *  Return a new ``int80`` type for %%v%%.
   */
  static int80(v) {
    return n(v, -80);
  }
  /**
   *  Return a new ``int88`` type for %%v%%.
   */
  static int88(v) {
    return n(v, -88);
  }
  /**
   *  Return a new ``int96`` type for %%v%%.
   */
  static int96(v) {
    return n(v, -96);
  }
  /**
   *  Return a new ``int104`` type for %%v%%.
   */
  static int104(v) {
    return n(v, -104);
  }
  /**
   *  Return a new ``int112`` type for %%v%%.
   */
  static int112(v) {
    return n(v, -112);
  }
  /**
   *  Return a new ``int120`` type for %%v%%.
   */
  static int120(v) {
    return n(v, -120);
  }
  /**
   *  Return a new ``int128`` type for %%v%%.
   */
  static int128(v) {
    return n(v, -128);
  }
  /**
   *  Return a new ``int136`` type for %%v%%.
   */
  static int136(v) {
    return n(v, -136);
  }
  /**
   *  Return a new ``int144`` type for %%v%%.
   */
  static int144(v) {
    return n(v, -144);
  }
  /**
   *  Return a new ``int52`` type for %%v%%.
   */
  static int152(v) {
    return n(v, -152);
  }
  /**
   *  Return a new ``int160`` type for %%v%%.
   */
  static int160(v) {
    return n(v, -160);
  }
  /**
   *  Return a new ``int168`` type for %%v%%.
   */
  static int168(v) {
    return n(v, -168);
  }
  /**
   *  Return a new ``int176`` type for %%v%%.
   */
  static int176(v) {
    return n(v, -176);
  }
  /**
   *  Return a new ``int184`` type for %%v%%.
   */
  static int184(v) {
    return n(v, -184);
  }
  /**
   *  Return a new ``int92`` type for %%v%%.
   */
  static int192(v) {
    return n(v, -192);
  }
  /**
   *  Return a new ``int200`` type for %%v%%.
   */
  static int200(v) {
    return n(v, -200);
  }
  /**
   *  Return a new ``int208`` type for %%v%%.
   */
  static int208(v) {
    return n(v, -208);
  }
  /**
   *  Return a new ``int216`` type for %%v%%.
   */
  static int216(v) {
    return n(v, -216);
  }
  /**
   *  Return a new ``int224`` type for %%v%%.
   */
  static int224(v) {
    return n(v, -224);
  }
  /**
   *  Return a new ``int232`` type for %%v%%.
   */
  static int232(v) {
    return n(v, -232);
  }
  /**
   *  Return a new ``int240`` type for %%v%%.
   */
  static int240(v) {
    return n(v, -240);
  }
  /**
   *  Return a new ``int248`` type for %%v%%.
   */
  static int248(v) {
    return n(v, -248);
  }
  /**
   *  Return a new ``int256`` type for %%v%%.
   */
  static int256(v) {
    return n(v, -256);
  }
  /**
   *  Return a new ``int256`` type for %%v%%.
   */
  static int(v) {
    return n(v, -256);
  }
  /**
   *  Return a new ``bytes1`` type for %%v%%.
   */
  static bytes1(v) {
    return b(v, 1);
  }
  /**
   *  Return a new ``bytes2`` type for %%v%%.
   */
  static bytes2(v) {
    return b(v, 2);
  }
  /**
   *  Return a new ``bytes3`` type for %%v%%.
   */
  static bytes3(v) {
    return b(v, 3);
  }
  /**
   *  Return a new ``bytes4`` type for %%v%%.
   */
  static bytes4(v) {
    return b(v, 4);
  }
  /**
   *  Return a new ``bytes5`` type for %%v%%.
   */
  static bytes5(v) {
    return b(v, 5);
  }
  /**
   *  Return a new ``bytes6`` type for %%v%%.
   */
  static bytes6(v) {
    return b(v, 6);
  }
  /**
   *  Return a new ``bytes7`` type for %%v%%.
   */
  static bytes7(v) {
    return b(v, 7);
  }
  /**
   *  Return a new ``bytes8`` type for %%v%%.
   */
  static bytes8(v) {
    return b(v, 8);
  }
  /**
   *  Return a new ``bytes9`` type for %%v%%.
   */
  static bytes9(v) {
    return b(v, 9);
  }
  /**
   *  Return a new ``bytes10`` type for %%v%%.
   */
  static bytes10(v) {
    return b(v, 10);
  }
  /**
   *  Return a new ``bytes11`` type for %%v%%.
   */
  static bytes11(v) {
    return b(v, 11);
  }
  /**
   *  Return a new ``bytes12`` type for %%v%%.
   */
  static bytes12(v) {
    return b(v, 12);
  }
  /**
   *  Return a new ``bytes13`` type for %%v%%.
   */
  static bytes13(v) {
    return b(v, 13);
  }
  /**
   *  Return a new ``bytes14`` type for %%v%%.
   */
  static bytes14(v) {
    return b(v, 14);
  }
  /**
   *  Return a new ``bytes15`` type for %%v%%.
   */
  static bytes15(v) {
    return b(v, 15);
  }
  /**
   *  Return a new ``bytes16`` type for %%v%%.
   */
  static bytes16(v) {
    return b(v, 16);
  }
  /**
   *  Return a new ``bytes17`` type for %%v%%.
   */
  static bytes17(v) {
    return b(v, 17);
  }
  /**
   *  Return a new ``bytes18`` type for %%v%%.
   */
  static bytes18(v) {
    return b(v, 18);
  }
  /**
   *  Return a new ``bytes19`` type for %%v%%.
   */
  static bytes19(v) {
    return b(v, 19);
  }
  /**
   *  Return a new ``bytes20`` type for %%v%%.
   */
  static bytes20(v) {
    return b(v, 20);
  }
  /**
   *  Return a new ``bytes21`` type for %%v%%.
   */
  static bytes21(v) {
    return b(v, 21);
  }
  /**
   *  Return a new ``bytes22`` type for %%v%%.
   */
  static bytes22(v) {
    return b(v, 22);
  }
  /**
   *  Return a new ``bytes23`` type for %%v%%.
   */
  static bytes23(v) {
    return b(v, 23);
  }
  /**
   *  Return a new ``bytes24`` type for %%v%%.
   */
  static bytes24(v) {
    return b(v, 24);
  }
  /**
   *  Return a new ``bytes25`` type for %%v%%.
   */
  static bytes25(v) {
    return b(v, 25);
  }
  /**
   *  Return a new ``bytes26`` type for %%v%%.
   */
  static bytes26(v) {
    return b(v, 26);
  }
  /**
   *  Return a new ``bytes27`` type for %%v%%.
   */
  static bytes27(v) {
    return b(v, 27);
  }
  /**
   *  Return a new ``bytes28`` type for %%v%%.
   */
  static bytes28(v) {
    return b(v, 28);
  }
  /**
   *  Return a new ``bytes29`` type for %%v%%.
   */
  static bytes29(v) {
    return b(v, 29);
  }
  /**
   *  Return a new ``bytes30`` type for %%v%%.
   */
  static bytes30(v) {
    return b(v, 30);
  }
  /**
   *  Return a new ``bytes31`` type for %%v%%.
   */
  static bytes31(v) {
    return b(v, 31);
  }
  /**
   *  Return a new ``bytes32`` type for %%v%%.
   */
  static bytes32(v) {
    return b(v, 32);
  }
  /**
   *  Return a new ``address`` type for %%v%%.
   */
  static address(v) {
    return new _Typed(_gaurd, "address", v);
  }
  /**
   *  Return a new ``bool`` type for %%v%%.
   */
  static bool(v) {
    return new _Typed(_gaurd, "bool", !!v);
  }
  /**
   *  Return a new ``bytes`` type for %%v%%.
   */
  static bytes(v) {
    return new _Typed(_gaurd, "bytes", v);
  }
  /**
   *  Return a new ``string`` type for %%v%%.
   */
  static string(v) {
    return new _Typed(_gaurd, "string", v);
  }
  /**
   *  Return a new ``array`` type for %%v%%, allowing %%dynamic%% length.
   */
  static array(v, dynamic) {
    throw new Error("not implemented yet");
    return new _Typed(_gaurd, "array", v, dynamic);
  }
  /**
   *  Return a new ``tuple`` type for %%v%%, with the optional %%name%%.
   */
  static tuple(v, name) {
    throw new Error("not implemented yet");
    return new _Typed(_gaurd, "tuple", v, name);
  }
  /**
   *  Return a new ``uint8`` type for %%v%%.
   */
  static overrides(v) {
    return new _Typed(_gaurd, "overrides", Object.assign({}, v));
  }
  /**
   *  Returns true only if %%value%% is a [[Typed]] instance.
   */
  static isTyped(value) {
    return value && typeof value === "object" && "_typedSymbol" in value && value._typedSymbol === _typedSymbol;
  }
  /**
   *  If the value is a [[Typed]] instance, validates the underlying value
   *  and returns it, otherwise returns value directly.
   *
   *  This is useful for functions that with to accept either a [[Typed]]
   *  object or values.
   */
  static dereference(value, type) {
    if (_Typed.isTyped(value)) {
      if (value.type !== type) {
        throw new Error(`invalid type: expecetd ${type}, got ${value.type}`);
      }
      return value.value;
    }
    return value;
  }
};

// node_modules/ethers/lib.esm/abi/coders/address.js
var AddressCoder = class extends Coder {
  constructor(localName) {
    super("address", "address", localName, false);
  }
  defaultValue() {
    return "0x0000000000000000000000000000000000000000";
  }
  encode(writer, _value) {
    let value = Typed.dereference(_value, "string");
    try {
      value = getAddress(value);
    } catch (error) {
      return this._throwError(error.message, _value);
    }
    return writer.writeValue(value);
  }
  decode(reader) {
    return getAddress(toBeHex(reader.readValue(), 20));
  }
};

// node_modules/ethers/lib.esm/abi/coders/anonymous.js
var AnonymousCoder = class extends Coder {
  coder;
  constructor(coder) {
    super(coder.name, coder.type, "_", coder.dynamic);
    this.coder = coder;
  }
  defaultValue() {
    return this.coder.defaultValue();
  }
  encode(writer, value) {
    return this.coder.encode(writer, value);
  }
  decode(reader) {
    return this.coder.decode(reader);
  }
};

// node_modules/ethers/lib.esm/abi/coders/array.js
function pack(writer, coders, values) {
  let arrayValues = [];
  if (Array.isArray(values)) {
    arrayValues = values;
  } else if (values && typeof values === "object") {
    let unique = {};
    arrayValues = coders.map((coder) => {
      const name = coder.localName;
      assert(name, "cannot encode object for signature with missing names", "INVALID_ARGUMENT", { argument: "values", info: { coder }, value: values });
      assert(!unique[name], "cannot encode object for signature with duplicate names", "INVALID_ARGUMENT", { argument: "values", info: { coder }, value: values });
      unique[name] = true;
      return values[name];
    });
  } else {
    assertArgument(false, "invalid tuple value", "tuple", values);
  }
  assertArgument(coders.length === arrayValues.length, "types/value length mismatch", "tuple", values);
  let staticWriter = new Writer();
  let dynamicWriter = new Writer();
  let updateFuncs = [];
  coders.forEach((coder, index) => {
    let value = arrayValues[index];
    if (coder.dynamic) {
      let dynamicOffset = dynamicWriter.length;
      coder.encode(dynamicWriter, value);
      let updateFunc = staticWriter.writeUpdatableValue();
      updateFuncs.push((baseOffset) => {
        updateFunc(baseOffset + dynamicOffset);
      });
    } else {
      coder.encode(staticWriter, value);
    }
  });
  updateFuncs.forEach((func) => {
    func(staticWriter.length);
  });
  let length = writer.appendWriter(staticWriter);
  length += writer.appendWriter(dynamicWriter);
  return length;
}
function unpack(reader, coders) {
  let values = [];
  let keys = [];
  let baseReader = reader.subReader(0);
  coders.forEach((coder) => {
    let value = null;
    if (coder.dynamic) {
      let offset = reader.readIndex();
      let offsetReader = baseReader.subReader(offset);
      try {
        value = coder.decode(offsetReader);
      } catch (error) {
        if (isError(error, "BUFFER_OVERRUN")) {
          throw error;
        }
        value = error;
        value.baseType = coder.name;
        value.name = coder.localName;
        value.type = coder.type;
      }
    } else {
      try {
        value = coder.decode(reader);
      } catch (error) {
        if (isError(error, "BUFFER_OVERRUN")) {
          throw error;
        }
        value = error;
        value.baseType = coder.name;
        value.name = coder.localName;
        value.type = coder.type;
      }
    }
    if (value == void 0) {
      throw new Error("investigate");
    }
    values.push(value);
    keys.push(coder.localName || null);
  });
  return Result.fromItems(values, keys);
}
var ArrayCoder = class extends Coder {
  coder;
  length;
  constructor(coder, length, localName) {
    const type = coder.type + "[" + (length >= 0 ? length : "") + "]";
    const dynamic = length === -1 || coder.dynamic;
    super("array", type, localName, dynamic);
    defineProperties(this, { coder, length });
  }
  defaultValue() {
    const defaultChild = this.coder.defaultValue();
    const result2 = [];
    for (let i = 0; i < this.length; i++) {
      result2.push(defaultChild);
    }
    return result2;
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "array");
    if (!Array.isArray(value)) {
      this._throwError("expected array value", value);
    }
    let count = this.length;
    if (count === -1) {
      count = value.length;
      writer.writeValue(value.length);
    }
    assertArgumentCount(value.length, count, "coder array" + (this.localName ? " " + this.localName : ""));
    let coders = [];
    for (let i = 0; i < value.length; i++) {
      coders.push(this.coder);
    }
    return pack(writer, coders, value);
  }
  decode(reader) {
    let count = this.length;
    if (count === -1) {
      count = reader.readIndex();
      assert(count * WordSize <= reader.dataLength, "insufficient data length", "BUFFER_OVERRUN", { buffer: reader.bytes, offset: count * WordSize, length: reader.dataLength });
    }
    let coders = [];
    for (let i = 0; i < count; i++) {
      coders.push(new AnonymousCoder(this.coder));
    }
    return unpack(reader, coders);
  }
};

// node_modules/ethers/lib.esm/abi/coders/boolean.js
var BooleanCoder = class extends Coder {
  constructor(localName) {
    super("bool", "bool", localName, false);
  }
  defaultValue() {
    return false;
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "bool");
    return writer.writeValue(value ? 1 : 0);
  }
  decode(reader) {
    return !!reader.readValue();
  }
};

// node_modules/ethers/lib.esm/abi/coders/bytes.js
var DynamicBytesCoder = class extends Coder {
  constructor(type, localName) {
    super(type, type, localName, true);
  }
  defaultValue() {
    return "0x";
  }
  encode(writer, value) {
    value = getBytesCopy(value);
    let length = writer.writeValue(value.length);
    length += writer.writeBytes(value);
    return length;
  }
  decode(reader) {
    return reader.readBytes(reader.readIndex(), true);
  }
};
var BytesCoder = class extends DynamicBytesCoder {
  constructor(localName) {
    super("bytes", localName);
  }
  decode(reader) {
    return hexlify(super.decode(reader));
  }
};

// node_modules/ethers/lib.esm/abi/coders/fixed-bytes.js
var FixedBytesCoder = class extends Coder {
  size;
  constructor(size, localName) {
    let name = "bytes" + String(size);
    super(name, name, localName, false);
    defineProperties(this, { size }, { size: "number" });
  }
  defaultValue() {
    return "0x0000000000000000000000000000000000000000000000000000000000000000".substring(0, 2 + this.size * 2);
  }
  encode(writer, _value) {
    let data = getBytesCopy(Typed.dereference(_value, this.type));
    if (data.length !== this.size) {
      this._throwError("incorrect data length", _value);
    }
    return writer.writeBytes(data);
  }
  decode(reader) {
    return hexlify(reader.readBytes(this.size));
  }
};

// node_modules/ethers/lib.esm/abi/coders/null.js
var Empty = new Uint8Array([]);
var NullCoder = class extends Coder {
  constructor(localName) {
    super("null", "", localName, false);
  }
  defaultValue() {
    return null;
  }
  encode(writer, value) {
    if (value != null) {
      this._throwError("not null", value);
    }
    return writer.writeBytes(Empty);
  }
  decode(reader) {
    reader.readBytes(0);
    return null;
  }
};

// node_modules/ethers/lib.esm/abi/coders/number.js
var BN_06 = BigInt(0);
var BN_14 = BigInt(1);
var BN_MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var NumberCoder = class extends Coder {
  size;
  signed;
  constructor(size, signed2, localName) {
    const name = (signed2 ? "int" : "uint") + size * 8;
    super(name, name, localName, false);
    defineProperties(this, { size, signed: signed2 }, { size: "number", signed: "boolean" });
  }
  defaultValue() {
    return 0;
  }
  encode(writer, _value) {
    let value = getBigInt(Typed.dereference(_value, this.type));
    let maxUintValue = mask(BN_MAX_UINT256, WordSize * 8);
    if (this.signed) {
      let bounds = mask(maxUintValue, this.size * 8 - 1);
      if (value > bounds || value < -(bounds + BN_14)) {
        this._throwError("value out-of-bounds", _value);
      }
      value = toTwos(value, 8 * WordSize);
    } else if (value < BN_06 || value > mask(maxUintValue, this.size * 8)) {
      this._throwError("value out-of-bounds", _value);
    }
    return writer.writeValue(value);
  }
  decode(reader) {
    let value = mask(reader.readValue(), this.size * 8);
    if (this.signed) {
      value = fromTwos(value, this.size * 8);
    }
    return value;
  }
};

// node_modules/ethers/lib.esm/abi/coders/string.js
var StringCoder = class extends DynamicBytesCoder {
  constructor(localName) {
    super("string", localName);
  }
  defaultValue() {
    return "";
  }
  encode(writer, _value) {
    return super.encode(writer, toUtf8Bytes(Typed.dereference(_value, "string")));
  }
  decode(reader) {
    return toUtf8String(super.decode(reader));
  }
};

// node_modules/ethers/lib.esm/abi/coders/tuple.js
var TupleCoder = class extends Coder {
  coders;
  constructor(coders, localName) {
    let dynamic = false;
    const types = [];
    coders.forEach((coder) => {
      if (coder.dynamic) {
        dynamic = true;
      }
      types.push(coder.type);
    });
    const type = "tuple(" + types.join(",") + ")";
    super("tuple", type, localName, dynamic);
    defineProperties(this, { coders: Object.freeze(coders.slice()) });
  }
  defaultValue() {
    const values = [];
    this.coders.forEach((coder) => {
      values.push(coder.defaultValue());
    });
    const uniqueNames = this.coders.reduce((accum, coder) => {
      const name = coder.localName;
      if (name) {
        if (!accum[name]) {
          accum[name] = 0;
        }
        accum[name]++;
      }
      return accum;
    }, {});
    this.coders.forEach((coder, index) => {
      let name = coder.localName;
      if (!name || uniqueNames[name] !== 1) {
        return;
      }
      if (name === "length") {
        name = "_length";
      }
      if (values[name] != null) {
        return;
      }
      values[name] = values[index];
    });
    return Object.freeze(values);
  }
  encode(writer, _value) {
    const value = Typed.dereference(_value, "tuple");
    return pack(writer, this.coders, value);
  }
  decode(reader) {
    return unpack(reader, this.coders);
  }
};

// node_modules/ethers/lib.esm/transaction/accesslist.js
function accessSetify(addr, storageKeys2) {
  return {
    address: getAddress(addr),
    storageKeys: storageKeys2.map((storageKey, index) => {
      assertArgument(isHexString(storageKey, 32), "invalid slot", `storageKeys[${index}]`, storageKey);
      return storageKey.toLowerCase();
    })
  };
}
function accessListify(value) {
  if (Array.isArray(value)) {
    return value.map((set, index) => {
      if (Array.isArray(set)) {
        assertArgument(set.length === 2, "invalid slot set", `value[${index}]`, set);
        return accessSetify(set[0], set[1]);
      }
      assertArgument(set != null && typeof set === "object", "invalid address-slot set", "value", value);
      return accessSetify(set.address, set.storageKeys);
    });
  }
  assertArgument(value != null && typeof value === "object", "invalid access list", "value", value);
  const result2 = Object.keys(value).map((addr) => {
    const storageKeys2 = value[addr].reduce((accum, storageKey) => {
      accum[storageKey] = true;
      return accum;
    }, {});
    return accessSetify(addr, Object.keys(storageKeys2).sort());
  });
  result2.sort((a, b2) => a.address.localeCompare(b2.address));
  return result2;
}

// node_modules/ethers/lib.esm/transaction/authorization.js
function authorizationify(auth) {
  return {
    address: getAddress(auth.address),
    nonce: getBigInt(auth.nonce != null ? auth.nonce : 0),
    chainId: getBigInt(auth.chainId != null ? auth.chainId : 0),
    signature: Signature.from(auth.signature)
  };
}

// node_modules/ethers/lib.esm/transaction/address.js
function computeAddress(key) {
  let pubkey;
  if (typeof key === "string") {
    pubkey = SigningKey.computePublicKey(key, false);
  } else {
    pubkey = key.publicKey;
  }
  return getAddress(keccak256("0x" + pubkey.substring(4)).substring(26));
}
function recoverAddress(digest, signature) {
  return computeAddress(SigningKey.recoverPublicKey(digest, signature));
}

// node_modules/ethers/lib.esm/transaction/transaction.js
var BN_07 = BigInt(0);
var BN_22 = BigInt(2);
var BN_272 = BigInt(27);
var BN_282 = BigInt(28);
var BN_352 = BigInt(35);
var BN_MAX_UINT = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
var inspect2 = Symbol.for("nodejs.util.inspect.custom");
var BLOB_SIZE = 4096 * 32;
var CELL_COUNT = 128;
function getKzgLibrary(kzg) {
  const blobToKzgCommitment = (blob) => {
    if ("computeBlobProof" in kzg) {
      if ("blobToKzgCommitment" in kzg && typeof kzg.blobToKzgCommitment === "function") {
        return getBytes(kzg.blobToKzgCommitment(hexlify(blob)));
      }
    } else if ("blobToKzgCommitment" in kzg && typeof kzg.blobToKzgCommitment === "function") {
      return getBytes(kzg.blobToKzgCommitment(blob));
    }
    if ("blobToKZGCommitment" in kzg && typeof kzg.blobToKZGCommitment === "function") {
      return getBytes(kzg.blobToKZGCommitment(hexlify(blob)));
    }
    assertArgument(false, "unsupported KZG library", "kzg", kzg);
  };
  const computeBlobKzgProof = (blob, commitment) => {
    if ("computeBlobProof" in kzg && typeof kzg.computeBlobProof === "function") {
      return getBytes(kzg.computeBlobProof(hexlify(blob), hexlify(commitment)));
    }
    if ("computeBlobKzgProof" in kzg && typeof kzg.computeBlobKzgProof === "function") {
      return kzg.computeBlobKzgProof(blob, commitment);
    }
    if ("computeBlobKZGProof" in kzg && typeof kzg.computeBlobKZGProof === "function") {
      return getBytes(kzg.computeBlobKZGProof(hexlify(blob), hexlify(commitment)));
    }
    assertArgument(false, "unsupported KZG library", "kzg", kzg);
  };
  return { blobToKzgCommitment, computeBlobKzgProof };
}
function getVersionedHash(version2, hash2) {
  let versioned = version2.toString(16);
  while (versioned.length < 2) {
    versioned = "0" + versioned;
  }
  versioned += sha2562(hash2).substring(4);
  return "0x" + versioned;
}
function handleAddress(value) {
  if (value === "0x") {
    return null;
  }
  return getAddress(value);
}
function handleAccessList(value, param) {
  try {
    return accessListify(value);
  } catch (error) {
    assertArgument(false, error.message, param, value);
  }
}
function handleAuthorizationList(value, param) {
  try {
    if (!Array.isArray(value)) {
      throw new Error("authorizationList: invalid array");
    }
    const result2 = [];
    for (let i = 0; i < value.length; i++) {
      const auth = value[i];
      if (!Array.isArray(auth)) {
        throw new Error(`authorization[${i}]: invalid array`);
      }
      if (auth.length !== 6) {
        throw new Error(`authorization[${i}]: wrong length`);
      }
      if (!auth[1]) {
        throw new Error(`authorization[${i}]: null address`);
      }
      result2.push({
        address: handleAddress(auth[1]),
        nonce: handleUint(auth[2], "nonce"),
        chainId: handleUint(auth[0], "chainId"),
        signature: Signature.from({
          yParity: handleNumber(auth[3], "yParity"),
          r: zeroPadValue(auth[4], 32),
          s: zeroPadValue(auth[5], 32)
        })
      });
    }
    return result2;
  } catch (error) {
    assertArgument(false, error.message, param, value);
  }
}
function handleNumber(_value, param) {
  if (_value === "0x") {
    return 0;
  }
  return getNumber(_value, param);
}
function handleUint(_value, param) {
  if (_value === "0x") {
    return BN_07;
  }
  const value = getBigInt(_value, param);
  assertArgument(value <= BN_MAX_UINT, "value exceeds uint size", param, value);
  return value;
}
function formatNumber(_value, name) {
  const value = getBigInt(_value, "value");
  const result2 = toBeArray(value);
  assertArgument(result2.length <= 32, `value too large`, `tx.${name}`, value);
  return result2;
}
function formatAccessList(value) {
  return accessListify(value).map((set) => [set.address, set.storageKeys]);
}
function formatAuthorizationList(value) {
  return value.map((a) => {
    return [
      formatNumber(a.chainId, "chainId"),
      a.address,
      formatNumber(a.nonce, "nonce"),
      formatNumber(a.signature.yParity, "yParity"),
      toBeArray(a.signature.r),
      toBeArray(a.signature._s)
    ];
  });
}
function formatHashes(value, param) {
  assertArgument(Array.isArray(value), `invalid ${param}`, "value", value);
  for (let i = 0; i < value.length; i++) {
    assertArgument(isHexString(value[i], 32), "invalid ${ param } hash", `value[${i}]`, value[i]);
  }
  return value;
}
function _parseLegacy(data) {
  const fields = decodeRlp(data);
  assertArgument(Array.isArray(fields) && (fields.length === 9 || fields.length === 6), "invalid field count for legacy transaction", "data", data);
  const tx = {
    type: 0,
    nonce: handleNumber(fields[0], "nonce"),
    gasPrice: handleUint(fields[1], "gasPrice"),
    gasLimit: handleUint(fields[2], "gasLimit"),
    to: handleAddress(fields[3]),
    value: handleUint(fields[4], "value"),
    data: hexlify(fields[5]),
    chainId: BN_07
  };
  if (fields.length === 6) {
    return tx;
  }
  const v = handleUint(fields[6], "v");
  const r = handleUint(fields[7], "r");
  const s = handleUint(fields[8], "s");
  if (r === BN_07 && s === BN_07) {
    tx.chainId = v;
  } else {
    let chainId = (v - BN_352) / BN_22;
    if (chainId < BN_07) {
      chainId = BN_07;
    }
    tx.chainId = chainId;
    assertArgument(chainId !== BN_07 || (v === BN_272 || v === BN_282), "non-canonical legacy v", "v", fields[6]);
    tx.signature = Signature.from({
      r: zeroPadValue(fields[7], 32),
      s: zeroPadValue(fields[8], 32),
      v
    });
  }
  return tx;
}
function _serializeLegacy(tx, sig) {
  const fields = [
    formatNumber(tx.nonce, "nonce"),
    formatNumber(tx.gasPrice || 0, "gasPrice"),
    formatNumber(tx.gasLimit, "gasLimit"),
    tx.to || "0x",
    formatNumber(tx.value, "value"),
    tx.data
  ];
  let chainId = BN_07;
  if (tx.chainId != BN_07) {
    chainId = getBigInt(tx.chainId, "tx.chainId");
    assertArgument(!sig || sig.networkV == null || sig.legacyChainId === chainId, "tx.chainId/sig.v mismatch", "sig", sig);
  } else if (tx.signature) {
    const legacy = tx.signature.legacyChainId;
    if (legacy != null) {
      chainId = legacy;
    }
  }
  if (!sig) {
    if (chainId !== BN_07) {
      fields.push(toBeArray(chainId));
      fields.push("0x");
      fields.push("0x");
    }
    return encodeRlp(fields);
  }
  let v = BigInt(27 + sig.yParity);
  if (chainId !== BN_07) {
    v = Signature.getChainIdV(chainId, sig.v);
  } else if (BigInt(sig.v) !== v) {
    assertArgument(false, "tx.chainId/sig.v mismatch", "sig", sig);
  }
  fields.push(toBeArray(v));
  fields.push(toBeArray(sig.r));
  fields.push(toBeArray(sig._s));
  return encodeRlp(fields);
}
function _parseEipSignature(tx, fields) {
  let yParity;
  try {
    yParity = handleNumber(fields[0], "yParity");
    if (yParity !== 0 && yParity !== 1) {
      throw new Error("bad yParity");
    }
  } catch (error) {
    assertArgument(false, "invalid yParity", "yParity", fields[0]);
  }
  const r = zeroPadValue(fields[1], 32);
  const s = zeroPadValue(fields[2], 32);
  const signature = Signature.from({ r, s, yParity });
  tx.signature = signature;
}
function _parseEip1559(data) {
  const fields = decodeRlp(getBytes(data).slice(1));
  assertArgument(Array.isArray(fields) && (fields.length === 9 || fields.length === 12), "invalid field count for transaction type: 2", "data", hexlify(data));
  const tx = {
    type: 2,
    chainId: handleUint(fields[0], "chainId"),
    nonce: handleNumber(fields[1], "nonce"),
    maxPriorityFeePerGas: handleUint(fields[2], "maxPriorityFeePerGas"),
    maxFeePerGas: handleUint(fields[3], "maxFeePerGas"),
    gasPrice: null,
    gasLimit: handleUint(fields[4], "gasLimit"),
    to: handleAddress(fields[5]),
    value: handleUint(fields[6], "value"),
    data: hexlify(fields[7]),
    accessList: handleAccessList(fields[8], "accessList")
  };
  if (fields.length === 9) {
    return tx;
  }
  _parseEipSignature(tx, fields.slice(9));
  return tx;
}
function _serializeEip1559(tx, sig) {
  const fields = [
    formatNumber(tx.chainId, "chainId"),
    formatNumber(tx.nonce, "nonce"),
    formatNumber(tx.maxPriorityFeePerGas || 0, "maxPriorityFeePerGas"),
    formatNumber(tx.maxFeePerGas || 0, "maxFeePerGas"),
    formatNumber(tx.gasLimit, "gasLimit"),
    tx.to || "0x",
    formatNumber(tx.value, "value"),
    tx.data,
    formatAccessList(tx.accessList || [])
  ];
  if (sig) {
    fields.push(formatNumber(sig.yParity, "yParity"));
    fields.push(toBeArray(sig.r));
    fields.push(toBeArray(sig.s));
  }
  return concat(["0x02", encodeRlp(fields)]);
}
function _parseEip2930(data) {
  const fields = decodeRlp(getBytes(data).slice(1));
  assertArgument(Array.isArray(fields) && (fields.length === 8 || fields.length === 11), "invalid field count for transaction type: 1", "data", hexlify(data));
  const tx = {
    type: 1,
    chainId: handleUint(fields[0], "chainId"),
    nonce: handleNumber(fields[1], "nonce"),
    gasPrice: handleUint(fields[2], "gasPrice"),
    gasLimit: handleUint(fields[3], "gasLimit"),
    to: handleAddress(fields[4]),
    value: handleUint(fields[5], "value"),
    data: hexlify(fields[6]),
    accessList: handleAccessList(fields[7], "accessList")
  };
  if (fields.length === 8) {
    return tx;
  }
  _parseEipSignature(tx, fields.slice(8));
  return tx;
}
function _serializeEip2930(tx, sig) {
  const fields = [
    formatNumber(tx.chainId, "chainId"),
    formatNumber(tx.nonce, "nonce"),
    formatNumber(tx.gasPrice || 0, "gasPrice"),
    formatNumber(tx.gasLimit, "gasLimit"),
    tx.to || "0x",
    formatNumber(tx.value, "value"),
    tx.data,
    formatAccessList(tx.accessList || [])
  ];
  if (sig) {
    fields.push(formatNumber(sig.yParity, "recoveryParam"));
    fields.push(toBeArray(sig.r));
    fields.push(toBeArray(sig.s));
  }
  return concat(["0x01", encodeRlp(fields)]);
}
function _parseEip4844(data) {
  let fields = decodeRlp(getBytes(data).slice(1));
  let typeName = "3";
  let blobWrapperVersion = null;
  let blobs = null;
  if (fields.length === 4 && Array.isArray(fields[0])) {
    typeName = "3 (network format)";
    const fBlobs = fields[1], fCommits = fields[2], fProofs = fields[3];
    assertArgument(Array.isArray(fBlobs), "invalid network format: blobs not an array", "fields[1]", fBlobs);
    assertArgument(Array.isArray(fCommits), "invalid network format: commitments not an array", "fields[2]", fCommits);
    assertArgument(Array.isArray(fProofs), "invalid network format: proofs not an array", "fields[3]", fProofs);
    assertArgument(fBlobs.length === fCommits.length, "invalid network format: blobs/commitments length mismatch", "fields", fields);
    assertArgument(fBlobs.length === fProofs.length, "invalid network format: blobs/proofs length mismatch", "fields", fields);
    blobs = [];
    for (let i = 0; i < fields[1].length; i++) {
      blobs.push({
        data: fBlobs[i],
        commitment: fCommits[i],
        proof: fProofs[i]
      });
    }
    fields = fields[0];
  } else if (fields.length === 5 && Array.isArray(fields[0])) {
    typeName = "3 (EIP-7594 network format)";
    blobWrapperVersion = getNumber(fields[1]);
    const fBlobs = fields[2], fCommits = fields[3], fProofs = fields[4];
    assertArgument(blobWrapperVersion === 1, `unsupported EIP-7594 network format version: ${blobWrapperVersion}`, "fields[1]", blobWrapperVersion);
    assertArgument(Array.isArray(fBlobs), "invalid EIP-7594 network format: blobs not an array", "fields[2]", fBlobs);
    assertArgument(Array.isArray(fCommits), "invalid EIP-7594 network format: commitments not an array", "fields[3]", fCommits);
    assertArgument(Array.isArray(fProofs), "invalid EIP-7594 network format: proofs not an array", "fields[4]", fProofs);
    assertArgument(fBlobs.length === fCommits.length, "invalid network format: blobs/commitments length mismatch", "fields", fields);
    assertArgument(fBlobs.length * CELL_COUNT === fProofs.length, "invalid network format: blobs/proofs length mismatch", "fields", fields);
    blobs = [];
    for (let i = 0; i < fBlobs.length; i++) {
      const proof = [];
      for (let j = 0; j < CELL_COUNT; j++) {
        proof.push(fProofs[i * CELL_COUNT + j]);
      }
      blobs.push({
        data: fBlobs[i],
        commitment: fCommits[i],
        proof: concat(proof)
      });
    }
    fields = fields[0];
  }
  assertArgument(Array.isArray(fields) && (fields.length === 11 || fields.length === 14), `invalid field count for transaction type: ${typeName}`, "data", hexlify(data));
  const tx = {
    type: 3,
    chainId: handleUint(fields[0], "chainId"),
    nonce: handleNumber(fields[1], "nonce"),
    maxPriorityFeePerGas: handleUint(fields[2], "maxPriorityFeePerGas"),
    maxFeePerGas: handleUint(fields[3], "maxFeePerGas"),
    gasPrice: null,
    gasLimit: handleUint(fields[4], "gasLimit"),
    to: handleAddress(fields[5]),
    value: handleUint(fields[6], "value"),
    data: hexlify(fields[7]),
    accessList: handleAccessList(fields[8], "accessList"),
    maxFeePerBlobGas: handleUint(fields[9], "maxFeePerBlobGas"),
    blobVersionedHashes: fields[10],
    blobWrapperVersion
  };
  if (blobs) {
    tx.blobs = blobs;
  }
  assertArgument(tx.to != null, `invalid address for transaction type: ${typeName}`, "data", data);
  assertArgument(Array.isArray(tx.blobVersionedHashes), "invalid blobVersionedHashes: must be an array", "data", data);
  for (let i = 0; i < tx.blobVersionedHashes.length; i++) {
    assertArgument(isHexString(tx.blobVersionedHashes[i], 32), `invalid blobVersionedHash at index ${i}: must be length 32`, "data", data);
  }
  if (fields.length === 11) {
    return tx;
  }
  _parseEipSignature(tx, fields.slice(11));
  return tx;
}
function _serializeEip4844(tx, sig, blobs) {
  const fields = [
    formatNumber(tx.chainId, "chainId"),
    formatNumber(tx.nonce, "nonce"),
    formatNumber(tx.maxPriorityFeePerGas || 0, "maxPriorityFeePerGas"),
    formatNumber(tx.maxFeePerGas || 0, "maxFeePerGas"),
    formatNumber(tx.gasLimit, "gasLimit"),
    tx.to || ZeroAddress,
    formatNumber(tx.value, "value"),
    tx.data,
    formatAccessList(tx.accessList || []),
    formatNumber(tx.maxFeePerBlobGas || 0, "maxFeePerBlobGas"),
    formatHashes(tx.blobVersionedHashes || [], "blobVersionedHashes")
  ];
  if (sig) {
    fields.push(formatNumber(sig.yParity, "yParity"));
    fields.push(toBeArray(sig.r));
    fields.push(toBeArray(sig.s));
    if (blobs) {
      if (tx.blobWrapperVersion != null) {
        const wrapperVersion = toBeArray(tx.blobWrapperVersion);
        const cellProofs = [];
        for (const { proof } of blobs) {
          const p = getBytes(proof);
          const cellSize = p.length / CELL_COUNT;
          for (let i = 0; i < p.length; i += cellSize) {
            cellProofs.push(p.subarray(i, i + cellSize));
          }
        }
        return concat([
          "0x03",
          encodeRlp([
            fields,
            wrapperVersion,
            blobs.map((b2) => b2.data),
            blobs.map((b2) => b2.commitment),
            cellProofs
          ])
        ]);
      }
      return concat([
        "0x03",
        encodeRlp([
          fields,
          blobs.map((b2) => b2.data),
          blobs.map((b2) => b2.commitment),
          blobs.map((b2) => b2.proof)
        ])
      ]);
    }
  }
  return concat(["0x03", encodeRlp(fields)]);
}
function _parseEip7702(data) {
  const fields = decodeRlp(getBytes(data).slice(1));
  assertArgument(Array.isArray(fields) && (fields.length === 10 || fields.length === 13), "invalid field count for transaction type: 4", "data", hexlify(data));
  const tx = {
    type: 4,
    chainId: handleUint(fields[0], "chainId"),
    nonce: handleNumber(fields[1], "nonce"),
    maxPriorityFeePerGas: handleUint(fields[2], "maxPriorityFeePerGas"),
    maxFeePerGas: handleUint(fields[3], "maxFeePerGas"),
    gasPrice: null,
    gasLimit: handleUint(fields[4], "gasLimit"),
    to: handleAddress(fields[5]),
    value: handleUint(fields[6], "value"),
    data: hexlify(fields[7]),
    accessList: handleAccessList(fields[8], "accessList"),
    authorizationList: handleAuthorizationList(fields[9], "authorizationList")
  };
  if (fields.length === 10) {
    return tx;
  }
  _parseEipSignature(tx, fields.slice(10));
  return tx;
}
function _serializeEip7702(tx, sig) {
  const fields = [
    formatNumber(tx.chainId, "chainId"),
    formatNumber(tx.nonce, "nonce"),
    formatNumber(tx.maxPriorityFeePerGas || 0, "maxPriorityFeePerGas"),
    formatNumber(tx.maxFeePerGas || 0, "maxFeePerGas"),
    formatNumber(tx.gasLimit, "gasLimit"),
    tx.to || "0x",
    formatNumber(tx.value, "value"),
    tx.data,
    formatAccessList(tx.accessList || []),
    formatAuthorizationList(tx.authorizationList || [])
  ];
  if (sig) {
    fields.push(formatNumber(sig.yParity, "yParity"));
    fields.push(toBeArray(sig.r));
    fields.push(toBeArray(sig.s));
  }
  return concat(["0x04", encodeRlp(fields)]);
}
var Transaction = class _Transaction {
  #type;
  #to;
  #data;
  #nonce;
  #gasLimit;
  #gasPrice;
  #maxPriorityFeePerGas;
  #maxFeePerGas;
  #value;
  #chainId;
  #sig;
  #accessList;
  #maxFeePerBlobGas;
  #blobVersionedHashes;
  #kzg;
  #blobs;
  #auths;
  #blobWrapperVersion;
  /**
   *  The transaction type.
   *
   *  If null, the type will be automatically inferred based on
   *  explicit properties.
   */
  get type() {
    return this.#type;
  }
  set type(value) {
    switch (value) {
      case null:
        this.#type = null;
        break;
      case 0:
      case "legacy":
        this.#type = 0;
        break;
      case 1:
      case "berlin":
      case "eip-2930":
        this.#type = 1;
        break;
      case 2:
      case "london":
      case "eip-1559":
        this.#type = 2;
        break;
      case 3:
      case "cancun":
      case "eip-4844":
        this.#type = 3;
        break;
      case 4:
      case "pectra":
      case "eip-7702":
        this.#type = 4;
        break;
      default:
        assertArgument(false, "unsupported transaction type", "type", value);
    }
  }
  /**
   *  The name of the transaction type.
   */
  get typeName() {
    switch (this.type) {
      case 0:
        return "legacy";
      case 1:
        return "eip-2930";
      case 2:
        return "eip-1559";
      case 3:
        return "eip-4844";
      case 4:
        return "eip-7702";
    }
    return null;
  }
  /**
   *  The ``to`` address for the transaction or ``null`` if the
   *  transaction is an ``init`` transaction.
   */
  get to() {
    const value = this.#to;
    if (value == null && this.type === 3) {
      return ZeroAddress;
    }
    return value;
  }
  set to(value) {
    this.#to = value == null ? null : getAddress(value);
  }
  /**
   *  The transaction nonce.
   */
  get nonce() {
    return this.#nonce;
  }
  set nonce(value) {
    this.#nonce = getNumber(value, "value");
  }
  /**
   *  The gas limit.
   */
  get gasLimit() {
    return this.#gasLimit;
  }
  set gasLimit(value) {
    this.#gasLimit = getBigInt(value);
  }
  /**
   *  The gas price.
   *
   *  On legacy networks this defines the fee that will be paid. On
   *  EIP-1559 networks, this should be ``null``.
   */
  get gasPrice() {
    const value = this.#gasPrice;
    if (value == null && (this.type === 0 || this.type === 1)) {
      return BN_07;
    }
    return value;
  }
  set gasPrice(value) {
    this.#gasPrice = value == null ? null : getBigInt(value, "gasPrice");
  }
  /**
   *  The maximum priority fee per unit of gas to pay. On legacy
   *  networks this should be ``null``.
   */
  get maxPriorityFeePerGas() {
    const value = this.#maxPriorityFeePerGas;
    if (value == null) {
      if (this.type === 2 || this.type === 3) {
        return BN_07;
      }
      return null;
    }
    return value;
  }
  set maxPriorityFeePerGas(value) {
    this.#maxPriorityFeePerGas = value == null ? null : getBigInt(value, "maxPriorityFeePerGas");
  }
  /**
   *  The maximum total fee per unit of gas to pay. On legacy
   *  networks this should be ``null``.
   */
  get maxFeePerGas() {
    const value = this.#maxFeePerGas;
    if (value == null) {
      if (this.type === 2 || this.type === 3) {
        return BN_07;
      }
      return null;
    }
    return value;
  }
  set maxFeePerGas(value) {
    this.#maxFeePerGas = value == null ? null : getBigInt(value, "maxFeePerGas");
  }
  /**
   *  The transaction data. For ``init`` transactions this is the
   *  deployment code.
   */
  get data() {
    return this.#data;
  }
  set data(value) {
    this.#data = hexlify(value);
  }
  /**
   *  The amount of ether (in wei) to send in this transactions.
   */
  get value() {
    return this.#value;
  }
  set value(value) {
    this.#value = getBigInt(value, "value");
  }
  /**
   *  The chain ID this transaction is valid on.
   */
  get chainId() {
    return this.#chainId;
  }
  set chainId(value) {
    this.#chainId = getBigInt(value);
  }
  /**
   *  If signed, the signature for this transaction.
   */
  get signature() {
    return this.#sig || null;
  }
  set signature(value) {
    this.#sig = value == null ? null : Signature.from(value);
  }
  isValid() {
    const sig = this.signature;
    if (sig && !sig.isValid()) {
      return false;
    }
    const auths = this.authorizationList;
    if (auths) {
      for (const auth of auths) {
        if (!auth.signature.isValid()) {
          return false;
        }
      }
    }
    return true;
  }
  /**
   *  The access list.
   *
   *  An access list permits discounted (but pre-paid) access to
   *  bytecode and state variable access within contract execution.
   */
  get accessList() {
    const value = this.#accessList || null;
    if (value == null) {
      if (this.type === 1 || this.type === 2 || this.type === 3) {
        return [];
      }
      return null;
    }
    return value;
  }
  set accessList(value) {
    this.#accessList = value == null ? null : accessListify(value);
  }
  get authorizationList() {
    const value = this.#auths || null;
    if (value == null) {
      if (this.type === 4) {
        return [];
      }
    }
    return value;
  }
  set authorizationList(auths) {
    this.#auths = auths == null ? null : auths.map((a) => authorizationify(a));
  }
  /**
   *  The max fee per blob gas for Cancun transactions.
   */
  get maxFeePerBlobGas() {
    const value = this.#maxFeePerBlobGas;
    if (value == null && this.type === 3) {
      return BN_07;
    }
    return value;
  }
  set maxFeePerBlobGas(value) {
    this.#maxFeePerBlobGas = value == null ? null : getBigInt(value, "maxFeePerBlobGas");
  }
  /**
   *  The BLOb versioned hashes for Cancun transactions.
   */
  get blobVersionedHashes() {
    let value = this.#blobVersionedHashes;
    if (value == null && this.type === 3) {
      return [];
    }
    return value;
  }
  set blobVersionedHashes(value) {
    if (value != null) {
      assertArgument(Array.isArray(value), "blobVersionedHashes must be an Array", "value", value);
      value = value.slice();
      for (let i = 0; i < value.length; i++) {
        assertArgument(isHexString(value[i], 32), "invalid blobVersionedHash", `value[${i}]`, value[i]);
      }
    }
    this.#blobVersionedHashes = value;
  }
  /**
   *  The BLObs for the Transaction, if any.
   *
   *  If ``blobs`` is non-``null``, then the [[seriailized]]
   *  will return the network formatted sidecar, otherwise it
   *  will return the standard [[link-eip-2718]] payload. The
   *  [[unsignedSerialized]] is unaffected regardless.
   *
   *  When setting ``blobs``, either fully valid [[Blob]] objects
   *  may be specified (i.e. correctly padded, with correct
   *  committments and proofs) or a raw [[BytesLike]] may
   *  be provided.
   *
   *  If raw [[BytesLike]] are provided, the [[kzg]] property **must**
   *  be already set. The blob will be correctly padded and the
   *  [[KzgLibrary]] will be used to compute the committment and
   *  proof for the blob.
   *
   *  A BLOb is a sequence of field elements, each of which must
   *  be within the BLS field modulo, so some additional processing
   *  may be required to encode arbitrary data to ensure each 32 byte
   *  field is within the valid range.
   *
   *  Setting this automatically populates [[blobVersionedHashes]],
   *  overwriting any existing values. Setting this to ``null``
   *  does **not** remove the [[blobVersionedHashes]], leaving them
   *  present.
   */
  get blobs() {
    if (this.#blobs == null) {
      return null;
    }
    return this.#blobs.map((b2) => Object.assign({}, b2));
  }
  set blobs(_blobs) {
    if (_blobs == null) {
      this.#blobs = null;
      return;
    }
    const blobs = [];
    const versionedHashes = [];
    for (let i = 0; i < _blobs.length; i++) {
      const blob = _blobs[i];
      if (isBytesLike(blob)) {
        assert(this.#kzg, "adding a raw blob requires a KZG library", "UNSUPPORTED_OPERATION", {
          operation: "set blobs()"
        });
        let data = getBytes(blob);
        assertArgument(data.length <= BLOB_SIZE, "blob is too large", `blobs[${i}]`, blob);
        if (data.length !== BLOB_SIZE) {
          const padded = new Uint8Array(BLOB_SIZE);
          padded.set(data);
          data = padded;
        }
        const commit = this.#kzg.blobToKzgCommitment(data);
        const proof = hexlify(this.#kzg.computeBlobKzgProof(data, commit));
        blobs.push({
          data: hexlify(data),
          commitment: hexlify(commit),
          proof
        });
        versionedHashes.push(getVersionedHash(1, commit));
      } else {
        const data = hexlify(blob.data);
        const commitment = hexlify(blob.commitment);
        const proof = hexlify(blob.proof);
        blobs.push({ data, commitment, proof });
        versionedHashes.push(getVersionedHash(1, commitment));
      }
    }
    this.#blobs = blobs;
    this.#blobVersionedHashes = versionedHashes;
  }
  get kzg() {
    return this.#kzg;
  }
  set kzg(kzg) {
    if (kzg == null) {
      this.#kzg = null;
    } else {
      this.#kzg = getKzgLibrary(kzg);
    }
  }
  get blobWrapperVersion() {
    return this.#blobWrapperVersion;
  }
  set blobWrapperVersion(value) {
    this.#blobWrapperVersion = value;
  }
  /**
   *  Creates a new Transaction with default values.
   */
  constructor() {
    this.#type = null;
    this.#to = null;
    this.#nonce = 0;
    this.#gasLimit = BN_07;
    this.#gasPrice = null;
    this.#maxPriorityFeePerGas = null;
    this.#maxFeePerGas = null;
    this.#data = "0x";
    this.#value = BN_07;
    this.#chainId = BN_07;
    this.#sig = null;
    this.#accessList = null;
    this.#maxFeePerBlobGas = null;
    this.#blobVersionedHashes = null;
    this.#kzg = null;
    this.#blobs = null;
    this.#auths = null;
    this.#blobWrapperVersion = null;
  }
  /**
   *  The transaction hash, if signed. Otherwise, ``null``.
   */
  get hash() {
    if (this.signature == null) {
      return null;
    }
    return keccak256(this.#getSerialized(true, false));
  }
  /**
   *  The pre-image hash of this transaction.
   *
   *  This is the digest that a [[Signer]] must sign to authorize
   *  this transaction.
   */
  get unsignedHash() {
    return keccak256(this.unsignedSerialized);
  }
  /**
   *  The sending address, if signed. Otherwise, ``null``.
   */
  get from() {
    if (this.signature == null) {
      return null;
    }
    return recoverAddress(this.unsignedHash, this.signature.getCanonical());
  }
  /**
   *  The public key of the sender, if signed. Otherwise, ``null``.
   */
  get fromPublicKey() {
    if (this.signature == null) {
      return null;
    }
    return SigningKey.recoverPublicKey(this.unsignedHash, this.signature.getCanonical());
  }
  /**
   *  Returns true if signed.
   *
   *  This provides a Type Guard that properties requiring a signed
   *  transaction are non-null.
   */
  isSigned() {
    return this.signature != null;
  }
  #getSerialized(signed2, sidecar) {
    assert(!signed2 || this.signature != null, "cannot serialize unsigned transaction; maybe you meant .unsignedSerialized", "UNSUPPORTED_OPERATION", { operation: ".serialized" });
    const sig = signed2 ? this.signature : null;
    switch (this.inferType()) {
      case 0:
        return _serializeLegacy(this, sig);
      case 1:
        return _serializeEip2930(this, sig);
      case 2:
        return _serializeEip1559(this, sig);
      case 3:
        return _serializeEip4844(this, sig, sidecar ? this.blobs : null);
      case 4:
        return _serializeEip7702(this, sig);
    }
    assert(false, "unsupported transaction type", "UNSUPPORTED_OPERATION", { operation: ".serialized" });
  }
  /**
   *  The serialized transaction.
   *
   *  This throws if the transaction is unsigned. For the pre-image,
   *  use [[unsignedSerialized]].
   */
  get serialized() {
    return this.#getSerialized(true, true);
  }
  /**
   *  The transaction pre-image.
   *
   *  The hash of this is the digest which needs to be signed to
   *  authorize this transaction.
   */
  get unsignedSerialized() {
    return this.#getSerialized(false, false);
  }
  /**
   *  Return the most "likely" type; currently the highest
   *  supported transaction type.
   */
  inferType() {
    const types = this.inferTypes();
    if (types.indexOf(2) >= 0) {
      return 2;
    }
    return types.pop();
  }
  /**
   *  Validates the explicit properties and returns a list of compatible
   *  transaction types.
   */
  inferTypes() {
    const hasGasPrice = this.gasPrice != null;
    const hasFee = this.maxFeePerGas != null || this.maxPriorityFeePerGas != null;
    const hasAccessList = this.accessList != null;
    const hasBlob = this.#maxFeePerBlobGas != null || this.#blobVersionedHashes;
    if (this.maxFeePerGas != null && this.maxPriorityFeePerGas != null) {
      assert(this.maxFeePerGas >= this.maxPriorityFeePerGas, "priorityFee cannot be more than maxFee", "BAD_DATA", { value: this });
    }
    assert(!hasFee || this.type !== 0 && this.type !== 1, "transaction type cannot have maxFeePerGas or maxPriorityFeePerGas", "BAD_DATA", { value: this });
    assert(this.type !== 0 || !hasAccessList, "legacy transaction cannot have accessList", "BAD_DATA", { value: this });
    const types = [];
    if (this.type != null) {
      types.push(this.type);
    } else {
      if (this.authorizationList && this.authorizationList.length) {
        types.push(4);
      } else if (hasFee) {
        types.push(2);
      } else if (hasGasPrice) {
        types.push(1);
        if (!hasAccessList) {
          types.push(0);
        }
      } else if (hasAccessList) {
        types.push(1);
        types.push(2);
      } else if (hasBlob && this.to) {
        types.push(3);
      } else {
        types.push(0);
        types.push(1);
        types.push(2);
        types.push(3);
      }
    }
    types.sort();
    return types;
  }
  /**
   *  Returns true if this transaction is a legacy transaction (i.e.
   *  ``type === 0``).
   *
   *  This provides a Type Guard that the related properties are
   *  non-null.
   */
  isLegacy() {
    return this.type === 0;
  }
  /**
   *  Returns true if this transaction is berlin hardform transaction (i.e.
   *  ``type === 1``).
   *
   *  This provides a Type Guard that the related properties are
   *  non-null.
   */
  isBerlin() {
    return this.type === 1;
  }
  /**
   *  Returns true if this transaction is london hardform transaction (i.e.
   *  ``type === 2``).
   *
   *  This provides a Type Guard that the related properties are
   *  non-null.
   */
  isLondon() {
    return this.type === 2;
  }
  /**
   *  Returns true if this transaction is an [[link-eip-4844]] BLOB
   *  transaction.
   *
   *  This provides a Type Guard that the related properties are
   *  non-null.
   */
  isCancun() {
    return this.type === 3;
  }
  /**
   *  Create a copy of this transaciton.
   */
  clone() {
    return _Transaction.from(this);
  }
  /**
   *  Return a JSON-friendly object.
   */
  toJSON() {
    const s = (v) => {
      if (v == null) {
        return null;
      }
      return v.toString();
    };
    return {
      type: this.type,
      to: this.to,
      //            from: this.from,
      data: this.data,
      nonce: this.nonce,
      gasLimit: s(this.gasLimit),
      gasPrice: s(this.gasPrice),
      maxPriorityFeePerGas: s(this.maxPriorityFeePerGas),
      maxFeePerGas: s(this.maxFeePerGas),
      value: s(this.value),
      chainId: s(this.chainId),
      sig: this.signature ? this.signature.toJSON() : null,
      accessList: this.accessList
    };
  }
  [inspect2]() {
    return this.toString();
  }
  toString() {
    const output2 = [];
    const add = (key) => {
      let value = this[key];
      if (typeof value === "string") {
        value = JSON.stringify(value);
      }
      output2.push(`${key}: ${value}`);
    };
    if (this.type) {
      add("type");
    }
    add("to");
    add("data");
    add("nonce");
    add("gasLimit");
    add("value");
    if (this.chainId != null) {
      add("chainId");
    }
    if (this.signature) {
      add("from");
      output2.push(`signature: ${this.signature.toString()}`);
    }
    const auths = this.authorizationList;
    if (auths) {
      const outputAuths = [];
      for (const auth of auths) {
        const o = [];
        o.push(`address: ${JSON.stringify(auth.address)}`);
        if (auth.nonce != null) {
          o.push(`nonce: ${auth.nonce}`);
        }
        if (auth.chainId != null) {
          o.push(`chainId: ${auth.chainId}`);
        }
        if (auth.signature) {
          o.push(`signature: ${auth.signature.toString()}`);
        }
        outputAuths.push(`Authorization { ${o.join(", ")} }`);
      }
      output2.push(`authorizations: [ ${outputAuths.join(", ")} ]`);
    }
    return `Transaction { ${output2.join(", ")} }`;
  }
  /**
   *  Create a **Transaction** from a serialized transaction or a
   *  Transaction-like object.
   */
  static from(tx) {
    if (tx == null) {
      return new _Transaction();
    }
    if (typeof tx === "string") {
      const payload = getBytes(tx);
      if (payload[0] >= 127) {
        return _Transaction.from(_parseLegacy(payload));
      }
      switch (payload[0]) {
        case 1:
          return _Transaction.from(_parseEip2930(payload));
        case 2:
          return _Transaction.from(_parseEip1559(payload));
        case 3:
          return _Transaction.from(_parseEip4844(payload));
        case 4:
          return _Transaction.from(_parseEip7702(payload));
      }
      assert(false, "unsupported transaction type", "UNSUPPORTED_OPERATION", { operation: "from" });
    }
    const result2 = new _Transaction();
    if (tx.type != null) {
      result2.type = tx.type;
    }
    if (tx.to != null) {
      result2.to = tx.to;
    }
    if (tx.nonce != null) {
      result2.nonce = tx.nonce;
    }
    if (tx.gasLimit != null) {
      result2.gasLimit = tx.gasLimit;
    }
    if (tx.gasPrice != null) {
      result2.gasPrice = tx.gasPrice;
    }
    if (tx.maxPriorityFeePerGas != null) {
      result2.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
    }
    if (tx.maxFeePerGas != null) {
      result2.maxFeePerGas = tx.maxFeePerGas;
    }
    if (tx.maxFeePerBlobGas != null) {
      result2.maxFeePerBlobGas = tx.maxFeePerBlobGas;
    }
    if (tx.data != null) {
      result2.data = tx.data;
    }
    if (tx.value != null) {
      result2.value = tx.value;
    }
    if (tx.chainId != null) {
      result2.chainId = tx.chainId;
    }
    if (tx.signature != null) {
      result2.signature = Signature.from(tx.signature);
    }
    if (tx.accessList != null) {
      result2.accessList = tx.accessList;
    }
    if (tx.authorizationList != null) {
      result2.authorizationList = tx.authorizationList;
    }
    if (tx.blobVersionedHashes != null) {
      result2.blobVersionedHashes = tx.blobVersionedHashes;
    }
    if (tx.kzg != null) {
      result2.kzg = tx.kzg;
    }
    if (tx.blobWrapperVersion != null) {
      result2.blobWrapperVersion = tx.blobWrapperVersion;
    }
    if (tx.blobs != null) {
      result2.blobs = tx.blobs;
    }
    if (tx.hash != null) {
      assertArgument(result2.isSigned(), "unsigned transaction cannot define '.hash'", "tx", tx);
      assertArgument(result2.hash === tx.hash, "hash mismatch", "tx", tx);
    }
    if (tx.from != null) {
      assertArgument(result2.isSigned(), "unsigned transaction cannot define '.from'", "tx", tx);
      assertArgument(result2.from.toLowerCase() === (tx.from || "").toLowerCase(), "from mismatch", "tx", tx);
    }
    return result2;
  }
};

// node_modules/ethers/lib.esm/hash/authorization.js
function hashAuthorization(auth) {
  assertArgument(typeof auth.address === "string", "invalid address for hashAuthorization", "auth.address", auth);
  return keccak256(concat([
    "0x05",
    encodeRlp([
      auth.chainId != null ? toBeArray(auth.chainId) : "0x",
      getAddress(auth.address),
      auth.nonce != null ? toBeArray(auth.nonce) : "0x"
    ])
  ]));
}

// node_modules/ethers/lib.esm/hash/id.js
function id(value) {
  return keccak256(toUtf8Bytes(value));
}

// node_modules/@adraffy/ens-normalize/dist/index.mjs
var COMPRESSED$1 = "AEkVMQnvDV0B0wKWAQYBQgDpATQAoQDcAIUApwBsAOMAcACTAEUAigBRAHkAPgA/ACwANwAoAGIAHgAvACsAJQAXAC8AHAAhACIALwAVACsAEQAiAAsAGwARABgAFwA7ACoAKwAsADQAFgAtABIAHAAhAA4AHQAdABUAFgAZAA0ADgAXABAAGQAUABIEtAYQASIUOjfDBdMAsQCuPwFnAKUBA10jAK5/Ly8vLwE/pwUJ6/0HPwbkMQVXBVgAPSs5APa2EQbIwQuUCkEDyJ4zAsUKLwKOoQKG2D+Ob4kCxcsCg/IBH98JAPKtAUECLY0KP48A4wDiChUAF9S5yAwLPZ0EG3cA/QI5GL0P6wkGKekFBIFnDRsHLQCrAGmR76WcfwBbBpMjBukAGwA7DJMAWxVbqft7uycM2yDPCLspA7EUOwD3LWujAKF9GAAXBCXXFgEdALkZzQT6CSBMNwmXCYgeG1ZZTOODQgATAAwAFQAOa1QAIQAOAEfuFdg98zlYypXmLgoQHV9NWD3sABMADAAVAA5rIFxAlwDD6wAbADkMxQAbFVup+3EB224cHQVbBeIC0J8CxLAKTBykZRRzGm1M9QC7DWcC4QALLTSJF8mRAoF7ARMbAL0NZwLhAAstAUhQJZFMCgMt+wUyCddpF60B10MASSsSdwIxFiEC6ye5N2sAOeEB9SUAxw7LtQEbY4EAsQUABQCK00kFG8MfBxcAqCfRAaErLQObAGcBChk+7Td0BBgXAKoBxwIhANMrEnM681CwBZA6dyc1SAX6JwVZBVivuAVpO11CEjpYQZd7k2ZfofgLEwPFByXxdyMEo0sCU1MCdRurJwGPo6U1WwNFFwSDYQkA0QarPy8jBykCOV0AawFhH3EAgx0ZAJUBSbcAJ2kXAa/FAzctIUNTAW9ZBmUCZQDxSRcDKQEFAElBAKsAXQBzACu1Bgfz7xmNfwAJIQApALMbRwHRAdsHCzGXeIHoAAoAEQA0AD0AODN3edPAEF8QXAFNCUxsOhULAqwPpgvlERUM0SrL09gANKkH6wNTB+sDUwNTB+sH6wNTB+sDUwNTA1MDUxwK8BrTwBBfD0gEbQWOBYsE1giDJkkRgQcoCNJUDXQeHEcDRQD8IyVJHDuTMwslQkwMTQMH/DZCbKd9OANHMatU9ZCiA8syTzlsAR5xEqAAKg9zHDW1Tn56R3GgCktPrrV/SWJOZwK+Oqg/+AohCZNvu3dOBj0QFyehEPMMLwGxATcN6UvUBO0GNwTFH3kZFQ/JlZgIoS3ZDOkm3y6dgFYj8Sp/BelL8DzZC0lRZA9VC2EJ3zpfgUoDHQEJIocK2Q01CGkQ7wrFZw3hEUEHNQPRSZYAoQb9Cw0dMRWxJgxiqAsFOXMG9xryC4smqxMlevgFzxodBkkBJRr7AMsu44WsWi1cGE9bBf8LISPDFKRQHA0hQLN4RBoXBxElpQKNQ2xKg1EyHo8h8jw5DWIuD1F4B/E8ARlLC308mkanRQoRzj6JPUQiRUwoBDF7LCsnhwnLD4EMtXxuAVUJHQmtDG0TLRETN8EINQcVKZcgJxEIHUaRYJYE85sD7xPNAwcFOwk9Bw8DsRwpEyoVJQUJgSDTAu820S6vAotWfAETBccPIR/bEExH3A7lCJcCYQN/JecAKRUdABMilwg/XwBbj9RTAS7HCMNqaCNwA2MU410RbweNDlMHoxwvFbsc3XDEXgeGBCifqwlXAXEJlQFbBN8IBTVXjJwgPWdPi1QYlyBdQTtd+AItDGEVm0S5h3QChw9nEhcBMQFvBzUM/QJzEekRZxCRCOeGADWxM/Q6IQRLIX8gDQojA0tsygsjJvUM9GUBnxJeAwg0OXfqZ6dgsiAX+QcVMsFBXCHtC45PyQyYGr0YPlQqGeAHuwPvGu8n5kFTBfsDnw86STPqBLkLZQiHCTsARQ6fEwfTGGYKbYzMAS2HAbOVA1ONfwJriwYzBwcAYweDBXXhABkCowifAAEAywNTADUCqQeZABUAgT0BOQMjKwEd4QKLA48ILccBkSsB7yUEF78MEQDzM25GAsOtAoBmZp4F2VQCigJFMQFJIQQBSkNNA6tt3QDXAEcGD9tDARGnRscW3z8B22snAMMA9wABMQcBPQHJAe9pALMBWwstCZ6vsQFJ5SUAfwARZwHTAoUA2QAxAHvtAU8ASQVV9QXPAktFAQ0tFCdTXQG3AxsBLwEJAHUGx4mhxQMbBGkHzwIQFxXdAu8qB7EDItsTyULBAr3aUQAyEgo0CrUKtB9f81wvAi1uPUwACh+kPsM/SgVNO087VDtPO1Q7TztUO087VDtPO1QDk7veu94KaF9BYecMog3QRMQ6RRPXYE1gLhPELbMUvRXKJVIZORq4JwEl4FUFDwAtz2YsCCg0cRe4ADspZIM9Y4IeLApHHONTjVT0LRcArUueM6sNqBsRRDwFQ3XpYiYWCgoeAmR9AmI+V0mrVzccAqHzAmiUAmYFAp+AOBcHAmY3AmYiBGoEewN/DwN+jjkCOXMTOX46Hx8CbBkCMjI4BgJtwwJtquuGL2NBJwFjANoA3QBGAQeUDIkA+ge+AAmxAncrAnaeOwJ5Rz8CeLYZWNdFqkbTAnw7AnrEAn0FAnzsBVUFHEf8SHlfIAAnEUlUSlcRE0rIAtD9AtDISyMDiEsDh+JEwZEuAvKdXP8DA6pLykwpIctNSE2rAos7AorUvRcDGT9jAbMCjjMCjlg8k30CjtUCjlh0UbBTMQZS0FSBApP3ApMIAOUAGFUaVatVzAIsFymRgjLdeGJFNzUCl5sC765YHaQAVSEClosClniYAKVZqFoFfUkANwKWsQKWSlxAXM0CmccCmWBcxl0DFQKclzm+OpkCnBICn5cCnrSGABkLLSYLAp3tAp6OALE5YTBh6wKezwKgagGlAp6bGwKeSqFjxGQjIScCJ6sCJnoCoPcCoEgCotkCocACpisCpcoCp/sAeQKn7mh4aK3/RWoYas0CrN8CrKoCrWMCrP4CVxkCVdgCsd3TAx9KbJMCsrkJArLkE2zcbV9tRFsDJckCtlg3O26MAylBArhaArlDEQK5JnNwMnDdAr0VArvWcJIDMg0CvoRx/gMzbQK+FnMec0sCw8cCwwBzfnRHMUF03AM8owM8lgM9uwLFeALGQwLGDIUCyGVNAshAAslLAskqAmSZAt3OeHVdeKp5IUvMAxifZv4CYfAZ75Ugewdejl63DQLPZwLPaCtHT87vD5sAwqkCz28BJeYDTg5+RwEC3CMC24YC0ksDUlgDU1sA/QNViICFO8cS6VxBghiCz4LKg4kC2sMC2dqEDIRFpzgDhqEAKwNkCoZtVfUAUQLfYQLetG9zAuIr7RAB8ywjAfSXAfLOgwLr7wLpbHUC6vUC6uAA9UMBtQLuhQLrmJamlv8C7jsDhdyYdXDccZ0C8v8AZQOOEpmPAvcPA5FqA5KDAveUAvnVAvhimhiap7czmxoDnX8C/vYBFwA1nxifrwMFiQOmZgOm1QDNwQMGZqGEogEFAwxFAQsBGwdpBl21YwEAtwRnuw2HHq8JABNxNQAfAy8SSQOFewFfIx0AjOsAHQDmnwObjQizBhufwQCnBRG76R09PhZ4BWg3PkArQiFCtF9xEV+8AJbFBTIAkEwZm7k7JmAyEbrPDi8YxhiJyfYFVwVYBVcFWAVjBVgFVwVYBVcFWAVXBVgFVwVYRhUI14VnAgICCmRe6SsEyQOxBi+7uwC7BKe7AOdAKRayBUY+aT5wQj9Ctl91N1/oAFgRM6sAjP7Ma8v8pudGej0mIwQrFic2NX5t32rB8RnCLGkBa9duMBcFXwVqycHJuAjPSVsAAAAKfF59i74AMz+BAAMW0QblrSMFAIzDCwMBDQDlZR09JB9KQrFCvEE4I18nYDYnOCMJwT0KRD9DPng+gT5wPnECiUK8SUI7X8tOT2pNCixrVC9qC24fX+AzOhsJZ5sKYiMrPB0mQqtCvCvMAcv8X8kOHy4JCAkifp3fajotShfJq8msCWXBy8wKYEFfD+UQoxEAk40dRUIlG6ltOc44CjM/Qz5wQj8cBwodTEdsWywtWuG8Egp97R0rQj8cXQhKCQ4zVENCNwQ7Q5wsCoEbLUI/G/UIUyIjGDAxAAWPYfBeCnFkyWALYC0jbkNgGTkCGx5gswYCaxBlTmBNEQFk52AVYJVgfWCzYEtgkWgWFwa1DtxVqbxaC0MWqwG7K83BAh8VABwDHgF5AmwvMJVSgAGKCrhHGgDkI3SOCsoNpk3qAZsCh5xPBUBfAPf3BwA0FlcMC6UMJB+6r0eAgQw0ABUTnyuCCHoC0gtLZREbANhOBnUECh5aADEAtritAJQnCxZvqyQ4nxkBWwGGCfwD2e0PBqoGSga5AB3LValaCbthE4kLLT8OuwG7ASICR1ooKCggHh8hLBImBiEMjQBUAm5XkEmVAW4fD3FHAdN1D85RIBmpsE3qBxEFTF8A9/cHAHoGJGwKKwulODAtx69WDQsAX7wLAGNAlQh6AOpN7yIbvwAxALa4rQCUJy07Ds4CkBh7ULtYyHRyjsOlmw/ZFUkb7AEpEFwSBh/lAccJOhCTBQ8rDDYLABEAs+AiAQIApADhAJiCCrJrOS8AFABbG8YubHYqDcEQAjskHNPhHB4LG30CewTBCqrxbAAnLQ6mLs6hHAe7CQAQOg+7GkcczaF3HgE9Kl8cLs4RGQB9q9ocAuugCAHCAULz5B9lAb4Jtwz6CDwKPgAFwAs9AksNuwi8DTwKvAk8DrsFmAEbawouzqEqD4sa4QHDAREWOwCgCzsLuxC7BBiqe9wAO2sMPAACpgm8BRvQ9QUBvgH6bsoGewG7D00RErwBAQDqAQAAdBVbBhbLFPxvF7sYOxjbL7ZtvgNIqLsAB7sALrsC6w5WAAq7BAAeuwJVICp/FTwVuwG+J+QAsloBvSjgo7vIAAFbAAG7AAJbAALjAAg7AA67AgAbu6VbDr/EAPQAaPuoOwMBu5UnSwDn3Rm7CBp7CKEFCv9wAN+7p7sau6OLeXIG+6mbgwASuwYbCwG8AACGAG27BgALu6c7ARo7ugihnMoBuwvtB8CpOwDhewG/AADlABW7AAb7AAm7AGmLABq7GLuOaRX7AA5rAC5LHgAGuwAXuwghAA1KAcIAt68mAcAAALQADpsAHBsBv/7hCqEABcYLFRXbAAebAEK7AQIAabsAC3sAHbsACLsJoQAFygBunxnVAJEIIQAFygABOwAH2wAdmwghAAaaAAl7ABsrAG0bAOa7gAAIWwAUuwkhAAbKAOOLAAk7C6EOxPtfAAc7AG6cQEgARwADOwAJrQM3AAcbABl7Abv/Aab7AAobAAo7AAn7p+sGuwAJGwADCwAQOwAIPAAUOwARawAPiwAN6wANuwAZCwYWGwAVOwBumxm7ALobLgATOwMAaSsKAOFLAAI7AARSABd7BRsABtAAGLsAC/sAX7sAa/sA5IsBuwAXdgG8AAFyC6EABUoAbXYAB/sA5XsAHGseAXsoUgA5RQD+Bw0McgAoKnABpAUIXgG8XiMMCQdvS2xfKokfPBRiLTYDoQq0AdgAFgLRA24BdnJHUhQhA08CFT4BLAYDc0a8e1J6QAApADEB+wBTCtsAe5AsASsAduUNETJGAUoAVwUAAVABB4rMAHg7BCClAFoA1hUAlWg3H4sAzWuxAM/UFgjCdXMbGFYdCdEBiJCrIlNTTUgSPMKJ+QB/HDdAKSvgEZdPAHIBKSwwKUIZDwMwVQT3xe4AS2XcAGoCcQI/EXo6x3guNdUGBQAQGx0KCAwqBB8dKU5TTgi5ugAKEs0AJgABGgCGAIkAjjUA7gC0AOAAnTwAuwCrAKYAoQDyAJ8A0wCcAOsBDAEHAMAAeQBaAMsAzQEHANcA6wCIAKIBNQDjANgA1QMBByoz1NTU1LbA3M3QzkMyFwFNAVcvRwFVAWQBYwFWAUdLQ0VoDQFOFQcIAzI2DAcAIg0kJiksODo6PT09Pj8OQB5RUVFRU1NSUylUVVdWVhxdYWFgYmEjZmhwb3JycnJycnR0dHR0dHR0dHR0dnZ3dnVbAEDsAEUAlgB0AC4AYvIAigBTAFMAMwJz6QCH//LyAGAAj+wAmwBLAF4AYPn5qgCBAIEAZQBSAK0AHgCyAH8CPAI/APgA4wD6APoA5AD7AOUA5QDkAOIAKQJ3AU0BPAE6AVABOgE6AToBNQE0ATQBNAEYAVQPACsIAABNFwoWAxUWDgCKAJIAogBLAGQYAi0AcABpAJEDEgMkKgMeQT5HKQCLAksAwwJTAqAAugKSApICkgKSApICkgKHApICkgKSApICkgKSApECkQKUApwCkwKSApICkAKQApACkAKOApECcQHQApMCmwKSApICkRZ5CwD6BQOnAl0CNhcBUBA1At4RCisTAUo3E02RAXekPAFlWQD/Az1HAQAAkykeGI9qAClgAGkALgCJA5TMi/CuhFoFuisOwhEBndV0KgsEIzFsATNabAGyAN5+gH9+gH6BgoJ+g4aEfoWIhoCHgoiCiX6Kfot+jIqNfo5+j4KQfpF+kn6TfpSDlYiWgpd+2gLabOEC2GwAgmwkbKAAg2xsBEkERgRIBEsESQRPBEwERwRNBE8ETgRKBEwETwCWZmwAowOIbAC0ZgEFbADJUWxsAM9sAgxsAPZabAD2ARkA9gD0APQA9QD0A31ebNSEI2XAAPYA9AD0APUA9BxsbACJWmwA9gCJARkA9gCJAL4A6AAIAPYAiQN9XmzUhCNlwBxsAPdabAEZAPYA9gD0APQA9QD0APcA9AD0APUA9AN9XmzUhCNlwBxsbACJWmwBGQD2AIkA9gCJAu0A9gCJAL4CNwD3AIkDfV5s1IQjZcAcbAJDATZsAkoBOWwCS8FsbAJXbGwDnwLtA58DnwOgA6ADoAOg1IQjZcAGA31ebBxsbACJWmwBGQOfAIkDnwCJAu0DnwCJAL4CNwOfAInUhCNlwAYDfV5sHGwEPmwAiQQ/AIkGjTFtIDFs1m4DKGwDrAJsbABVWv4VMgJsbACJAmwAVAEAul5sAmxebGwAiV5sAmxebD3YAEls1gJsbEbCxxP/x5BApA0KYFA89AsjTx97EHmJQPyocItC2JnNFRCEnFU6SFTDoI0PxeRNRoNRWkpzVnWW8pTagkNmgf+jGupqZ3eu50LAFnc+OzfJwdub1AdpOy76VnijWNR/CMEevikQkFyQuLuPajxWi9chqOoMJ7qpCN4sx3LJG4Myu8kD68wC6+iAwt+pU1JEeY13rpCVkXSZfinVKn4xZpxsI3Lp8bJLrJ9ujkrIalMRBAcv/GSKEtowzcEn5XmJw2BagB8V2UWJoJHZ14SXhM7p0XeGFOuw6mlvyq99WYp5XxrO6ru9nn4RHcOkJ7hx5UqWtman7yVMLzYXQefQRUdIY70RYQE8+aAzCNSGQkXiHfnHYRMi+xczKDdZLk3AV1gzxkkSHLjBwuq8shIJ+/RAbqjqQbugFhe0rqklu432EERkM5k9y1DXzds46oLqKAx6OhPT2WiqEfhaITn7OF9Y694AmKmUvbpWp0xJqDaf3jeNJXnK6NpnGcFOmbclbARC+5+5U52ufw5b0Hh+2LrrNimvZe4eYmApRsZnJE310SqB+1xB6rSJfnV1f2D0awB18Oc0sXAFqIlgHgWiaZGdvP5CJUSsCTCQUC335+iSkwPlLJJ5lwjTSn9Lw22NbK1Tu8w+bUpHtDRDPho7Gun8aw2Jzu9i+N0Ot/kPMbLAb/rUQ82kfpk85qLDkfxLl39QPDngo72GYh/Xigbpcm1pA23D2ywt3D8GgMOao040wDqkHxOEx0OhC+ZmHiIdjK7yRbfJD2ouZbAedhD3p7s8WDmCJfNforgDYPGAXSI08fTjPZ5B37lc5VXGzc1vJmibDwBNVzXuaUzg7N5H4BxqjhJ+kz9HLUJys7bpBDYAPvbut13AwJCWd059tS8YTYgC8HwrkewBfa1LSSpmMr9uR2EekTiAMH+Mx4AGzgbquccwBDlLmRhgXL/YiLPCEb6d2k5qJ6o800qddABkpqt7NG+sc2uvHZwZs57W1AHTFM1KkMShasADAh2FvzbzJOzVDMS3ZlT2BSFKdnkZFB6JyqJbhm6XANis9TrtzJdlPVp+rl8v3nIke6Jou7m2TKu53Vounupgkz2LzrQPhhatLIG7rfF/gUKWp15X3LKt+ZvuCDSqPUigF9yJntimC1HJR7Yj/dUrLAXWrT+1tnwPJJLGKAlQ5VeNDWRKCTt2vz3rJuo4+gIt75/Mkfl/gSZblZ9r/SEeeosZXneli/xNh1WVCvkRt2RnyyjtMkMqhzXh1PVOCbILqv0r7rGYm0CHIyKdhHL90cl9E1I6eEtQTCt6RXj8M0HHrHCHLVRpNM6WIbT5BCMGVnL0o5895qSRbCJz+5I8PGMhAN/Xrj4BgIdlKqlHtBHqTJwmK169toZ2IWxNzrAbIG7zh85Q/LG2A4yBcaBel52zdunokB0lv3A7kXnTI7M6ZnfZ7nwuj5lkGhqSpW+w5CI/FmRlplBEbnZy1ZxS3DL8rf1YWhO5XivWZBSRh1gFsjjyj3qRG1cm/6ors7WsEif6WRxns1MKDZa6KrbfMQ/swIb+2nb0tqxHeii6FcgVeAjE/Xwac1owx04dJKG8R5YQgHNnEfHf0qb8WOnU0eQSjazq+IK7cSuCqYzPEUB/x+QgGZqM3dBoYvNvZVOHDkbgdilWdagqO5bkybXfLpyMPuGq8mvAAEZGbR6RwXGlW9ErOWTfnjfx6dXFJqBj0OBSGFz4lWQasNOmVJeN4SFWSLfOGB/7ehV5YuoNNROHZEG9ElVuMnqbDMMuDleOt/cN/gsWxGw128mwU8/HxkOKqdTZnI7dHka67WCTf/FmBrxpNCaKJ1GxBTCSS7MNfhNj8S4Gtotg6Z3AM9cAeVROnppUMaiV5jjudLnNqoVrKO1/FijLlAc74kxydxKX1RQuMqHR63eecYr5o6MJ+B78VsLlCrpelWh6GOrCOBIoQmIcdpJL1pwE2zzZqBkecGTdK8KMOB6r1eNRURyrz6M899TZaoS/vNOxHf+5gORU+OyYIcIW6diP25GHF6u8TNjuL/GJzCnLLXd01KrsjRa51v4+O/VIAWXESJxfxWjv628J+cWUQpoD+Yytzs3jSMRJ23/XT+vUdtUMLDQq1vnIoeg/GjWh88MT6k9dRqDaQ+vodilFgvjuNw5pJpId9mfwyYeLCGb3BmHXdfQfhfPRQaupe/f8TG4Bk3eDKlYBaEK3kZYNN2Sdxz47m/vYBxvIOKtnqplB1pebzuXmAr/MuzQCknKe653dzaWQQ7MUhWYWvzIZwLe1v0rXxImLaz+AkAu+sYikhouNF3EW6w4crZ6MuUiDbIAx8XhAfegcvW6x9BPb3/sCxGWu9YyatqExB+TSm69qIkI9IwhjrcnzME+jWBx4mNQm5WwLzUjSyY4FZ0aMF5YFlXUD4hL4XfOeYv5rDe2s2D/Cn+28fZ9UCnOQvXFMnQqfc0G+ZqOWWD9l/liqUPaNQzZjxCHpUAD8Rcc90MniQ02ugHWsUupFUvhC9usY7zNPt5F2jO7qgzhafsQSd50jgLrC6Qx6bpHbXR3WNAu1BzGmwbz+ebGmwTjdy006Y6zipP7n/OJlvSmbq+SY+nefAVKK6EBMPbce5n3IdRI8+vbxCpN53rw3TvgNds1SuMiuLGxt89L71mxPDeanGhyHvOjmO56tnVpoHalQnL6TqNuqKsHjHCIKB4pCgj4WyYPvRvYvqi5EMr7lN3MotPR/KH7JUD1lZbU0QzfbrEBJnuQiVAyAC9vwXWp2TRU1/0aapyAH2cbglEHVAdl+1rb1u147uV0td1eNoQZsqHrIMIYVPXtLk2TIU3cJE08PjoYNDpfF/IcJnYQHl6nsplczX3Rgah4NbJJHl//5scUufqsSd//kbIS406ZWoMP//+jhGUswX/5nVNz/jAj9KmXPtAmMiK+khhbn1w/mELzZMT/WxcW//y/jsHaOM/61oAW/CjYhJtY622/TtMYuP7bilBvbiT3vB9n8IcFPnwM78H0KfhYDRdY5PhWJ4jWRQzB+HT5NVZV56LG82hcQms+jOTT/c9Y9sx5rPi1/wB7f/+c5UfUCKk3iwwCuywUc2MGnAwsXf1E5hoI55x1Q/Qby+sWH8NRjavZ8VaDsdi1NUVhH86BJHX1yaFt1w1OYeL5LVmdN+5Q+KuTvXEPDzUCg6xp0HhsUhTWSe7MZMM/6rsTUb0/nbUE3YQlGGt48kT1/6cnf6yHnvHtQx9EosOXN077yyEq/jE3YTiG/5SEJmXFeocJJ1EAd6vKeK6VEdJLOZ1km/EwOnZWCQpzCLKPHxrfh4yJhGq//2dos2E/3+MOcdW5EsgIdmTQUQetzRy5fQHhDBl37XbWzsqO/cASEDjyst1/8NEROqVAxWnddQV+umJ8IrKVgKvGaTc0GsQ4s8h0Osql5QKwlddPDjJhKInyWqYUKmmlIts+FIcXZ6yM6cljbsjUG2ksSOkuIw4sYHffRNgBOLApvD6XrR6Rt0rV2Uf8IpnIUVnb9Twt91QjAaD/dStSWDxg7aYY+VXIgnuowYdOkjywa2hlgrnI6PjaU3e3UjQ5Yk5mdIJGyHnv3/P+1EkMav1yFyF+FeJE/RXnWBw+Nh0aOo6TGlKX7d+dkP9+brvr79SdtXJtcD/aXBGiMNfG6/NQniQHYQlK78FEHDqOh+bDI0o+2Ub0h53EL/vlzjrBczVEZz2bOtvIL+DIzDkk9nCWt7tlqsq3l9JMtJk3r5HG2iJ9b/X11TG6wwMAjHLQ2oasaMEsydh88QPvI+hmqIHhvalpKoKOueJR0eZ9J8G2alNOIOy98jwvbc87Ewk9d+5G/tUijTmlbjFlDKXV05HalKxaRTrucc73On7yzAPS6f2v4ogiaWyWeV73dv/MsQT5HjRrsYV9dLAcI3T+zC2qEVINyNpEhoKV+xVSuWtT4AhBfpnZ7unIM+HX3msI0HiI+P+z2PFgkjGi5PqEbG/wNIWeRUjPtDEgbbubN+I4JaDLrW9borRBDob7ZFx+JdKeFVUKVeWqb/c88Ol7DhM0suLtuEd8tkDSMTD3DFx8UphPINHMHi51hAPttXL4Ektt/lKEUG/R4qZKohHjVpAcPIMiHyWr6xR8/EWnNJvBFET76yCdk5er7ADB/1bgoImhpSiZ/omZjPKPCEeZsOwvPmXL+1vlJNeGO3TzySmGA1X6e58gLrazDM71jywM1XL8zKHN6G3kB31Y8vLtP982N975SZXk2JwDvmv7AY/aDsFFk1v+nE7/hbvuOWhBH4kuemeYozPk2K22Vx/YGiDTLU7YilpOt29u3RZMBh4UJjlTP5ItxTzWv6ebL9b+GSU1Vsm2S8LMfVfJczaBSqE8J1A4YUjpsALL7++bwCPXFhaufdpDFtBlHb9makeYbqdg9ltvK/HwF/rNE6KrtWUkEcxmTB7Iyu5TiVaIgW/YxzQhpArliIMkOoK5L7ShVtF+DYqV01mk7fwop04hQRwg4KFmr5z9nYf05VVqkSe7gfnx5bxxlQ0qEV0jiwzf064qG11iEqjHcUgDWWsDs/LEGlzX31T5KVL+7D4EoKim7HBagiqRo5JI3WfDBgpKIruWz9j/J6Hp5Q/EJbMWB8NeSMuFarNw3AEYPBJtYQO/4oD/ZgPTSQ06di0EeumX5EbrdThO+fvYEVSxLtZ3AJkee0Xn0sDwNtiiZhJjJRDuG1YRKB1vOulfd9JjHeyu+UHTmrtra/pm+8Rixh4WKiLaLOCxIbZNoWRZSyyUGLPjAaAo+SQBpfO2uruWrzFxLlpvrXJNMCWtlJDKGAnlWK5xpU2tcxXbeD+sbdfwYXt/qTwDk6UqXR/aUt099DhSNl4Nk8mXwpw+b0nvjKOG6Mg1PRXjrMUMANvNgEArv8nMJs3vj1aHi8MHz/UfJWWzkcrSpZTNBhduXlGR7i+ip/THDp5R9KRNcDKECgtwgXg4EFN5HHfikP/XvsoCkHTg+NbsD8Gl6eknk4Arwn/BWGJ0hgW0/gUKrzuGZhub7igRP3abetpIm+24xEOlWl3YKpm2qTBFvX8ddDRvm1LcwnCJuEfZx12qPY9TrntMIQsv316zvpyWnyStX8VU4j6tQk+CWlLBUCJR6MdH9Cp7g2qdn2WM9qFbREmejH09dlWEPm8hPF0L7RxwRRdiCs0DP8ewk6ApoELkKU9hckSdbnXm8UHJmaNXjxv/q0fTTpu8rnl9lN0vQCpDRbCtcz12rGRFEA7Cfg7FhZn5QFkNmv1ZURKEsiZce1nS9K7HrwpC7yJV4Xt3eAVbLJfoXHrtwG60Z8gwaSnmxoL3s2ZlRqggZN/MHo1oUS4L+GwObFI596Ld4Mvi8l+cQmF1gJpkpnDio7TuO35npaMHiWzFqPSX3qNgkIPGuX0qGYnPIVsM901Yu8oZnOZOY1TbtIdFUNKNq2dP8SJ4F/VCEzIjF0/Rh+7UrZj80tC6rognVH3mqa8eCs/lcQU1Pjj98kBmAKDbZUTwosv02UunRR3n0X6c+f73mtwB7/WbQ16gO431EtwZbNG1SM4TZPBnsQSESlsfG2JLQXx5xWf4bmQ/xcVCPISAX5897JxHKLD/Xkgu57+ABR2+MMtEbX64+MNlBHpKC7sjlWVEShf5qA+dGc59LFVlZrX/Enq9z/v+wnZ1HErmxmjJjxOA+hAjVUWgtq6ygAi/8ewJDjUMFw3zhQFtbyTLDPFd21Ji5S5QPZo9nMSxdg1+DGFSN0wlWt7XeYPbHqLfliV0J1kOhQNp0VbUPy0MS2Ms66OxtSWvaULaWHnfAA+sieVVgtjDwN3nKonWapkSKRN8BKKJQpCfqo8RQI5udhfu5s5+7vwsppmAJDgz2GNA7d43VdbV2l/SrvEu4RYslmNJmfSOVbssxAhSYy6WxpIQdDB0FVBpZ6IM8yr81QN+XLZ3n/wed/R+s6LslkxKbzzst/GkRbe6rFmtvJCwr1T44ETM+IMgOnjUO0eG6a1n2w7lwM1oFBvzMUWRkNFOvKcx3oSb5XdenZ5dXsute6nkRypBiSdAtA2fxAd8UdLOZW/MB7fZoEuFheQXijdaF8kuaRZoSeWdKOkKsGYEGaXfaDKTu0WMTcLniQs7KRCz9iK3SP+Y2xIjkfVGqFLSQ6vh+A1u6FdfwXsv1VPMfi2cxmdM+/xTgMXEyo2ZGcQ2YmPsghnYdv2+z48JpGZA4tUK1p1q2VdVxyfypXEXcrxKKtmt8UdW7sHWmKMqDuBBM3J/JUQx8eUYN4pJ5oRqvdiPHU1o/WPjiKvnlCqOdyxlxF54L9PrtLD1NejZ9aZDivVr6ZfMFK1/psVygoPIAnphcJWWb9+5IKMKmgRQULsTPZi6Bw4wP32zVEoKcHpP73CkFAqS98nSaGoWDjDJiaACJn4p5o1jq9R4Q4VcibhXF//LHP0bdf63kRVZdRbbhGe7sDQcyWS5tpkfeYHnff25WK+4FpzLlAcbaKmHdIBqOw3fImx1uqQIADH0TyHzFlqTG6nMoY81svP0T6BIyELMS8tMe+E1p6TFP6sVpZa6VNaTumufD5aj9goRa9SAmdJT4HhI2r0egj8UrgFb8L59wGLnYlzkLAiUd3m/WWIIEU61kPoEjd3gIVy/fiBcgqQqHnoXpL0SqLGdGGgn7DQeVMSYWHfjno1FngIKP9cjYaTlcRP6bZunjHP13/lbVm4awti894pTf/ZNNqr4OR+tDVie/m+rC8QpVnRbsCMPukOH87B2jM4AG6pHuXl1x9SiKdhYJVOhfo/+SCaGjUW2CoogL1FFhFGN9o+acoVLl0SXs/3vrSccmZeAF3NewFuOg/P12QYKQF+SH+KYcNnsAhIAELPBUgre/KRUJEA+KPD0MHRjv+3J/j2Z23MuJmkfy7leWcMsti8wXLSHgXFJTaksx1Woi6oljwxFVIJG12SBSZLNJDbXMYPekmiXT4FclKI35BFgqnYpKfcsr+f8HUXQoHJ9UYZ4J5YMiHHyAxg6eidhodgqJ2Htf/xYEx+G0zXchuzlt8hcAl+AT8NCQ4orFc4DerabF1enA7NTLnvtZh3FUwqIOvY7Q4DYmoDHwXTSw5UNNh6r7j0B/ezMYJMDcw4+6gCTZX4YQ+7Xs8de72vsR3cmfpxIX64/6KR1p3VX4F6vfHEzxzarh8aDH4G1DFoBBM6npXFpK+Rh+WrcFclAeAxi0PoaR9CpOxxGLSdvxKVSw8oOOanG/soKImRopN38AdcUhhM2GT/PgQeSQrG12njuJJD5Z7vWfAZmFybYLdSA91kB4aoBhoj1Z//KNIVVujqaLLRwCkbyn4vh0739C9V9iSjybeOIeSOvNs7LW1a7EUtNoKAnOGML4U8KBXpfrw73WjAszJG4Qscq+Xr3kZWR4Omm0xT6qE9y6FNSpstV4onMZSqCEJ+3VX9qjvdx5QVrM0WXxmPZxejdfnihcFAjzv5PjlTl6ickDbHe6+Lch52pjOPqk+m3RZ+bh2JSMGtFBuODbMchrpRVlt16NTQ05Ps0IDtWlUmWfP2vX8M4YDynIuOZ4Ck91+591B98Gw9fw+yQogTR8CSg0zaJu+rlBo/mr3A+1NziF+kdubz+whc857AZt6DwIBIF5+5yiaaf3ByQp1Fm3sOkZDAzwsYSQTM/Kv6idkugF63FDobDdUY3huruU+sCaBuRR+HmOowvmZoBjZHNh77SXFtmY/oOUE7ifN7nBHAo83S/xvcS6H4Ci2u/9Id62Wv6Ui+zMNLAzhfkTkVcW2BwrnYvpur0ZDlzs+ZLsmGTWvd1892t78gx1YjEJusGcxphjLkV0UfAKlekfSBVWHE2ahk4AbbRmHyL7GYdtKfdlINwrcdJuf3Cee1nfUojDQn/YmItESOFhtLzrkEv4k2XpMU9oaJQ3VUC+1INh6BE68pkHameGJm4Gvdb24Q0fXWxd9Tp3A9mzFSe4qXDGGDIV4AAGV1jIDfveknH1TwWpUT6HiQxKP3AAHJNkJeRlj/mXBmS4S1j8FK6YmpK7jyyAiRbsMCCLoJcx01fvgpMvKQRxu9IOwymconQjD56g7ksOrcOeoTbius4JnGesAS1DtgdaophYsw1wGIsMS3P7K6doE3K5czznqPQLSRRF/Ylzb5NtSKsL33SgskFNCF4khn5LWaDxI23ZRi2hzqN8uW8UzZEBYy68+VtGLSymQrXGUlr2nO2BbBIT5Vh1RmGAyDXaW0FPrpx3wv2UYdFk9tSl+906bMxCuXQaKDQP/U19UEcVGK4gmksL8lAorxQSAOwpeYX9xrZsh6yoGaL/X5O3tgQC8OM+/GvxnW9XvAtu/JxAigydfSmZfqZfg1XOcHNOpLlN8j64OZ36l5qawDBJ62YaTvxeNmm5gowCdBosgcpHOgNgwA+sknN8XmsR2IYChcafl9bGNMZ/nB5guWuvEziv6QI2bP2DtyKWG/qUjZMaxy+wASkkVGtuwGtywkTYG6MYrZBo18vYcww48G/+f+eITA/qMwbLlJC0S3+/ai2pPvkOhRRVmGTuSupaxhIk0xoXLtixCxSAn4Z3OnUS3wBqVscLI4P3GP7i/6gxYsswsVmkvDXFLhO/OKcur8flegCSKiqmVpIRvCzgbjEA0mXPn+RExXY/2OE1f/BYuWpRQY8gCDpMOYBx9Gn4tL3hihSIR1ixh2PIIT7cr2gUJbfs76EKYG52Jk0UZF/PQkBxGuFCEWXnG6ue/hTIqjTRq1sotVrKrwIGHDrITyuanUzbIYdgdEeV88K1VD82TYB2B61Ft+tB1KqHPmT9+hWoaV+iF3SuvtJqvnoLaA8wxrD56AUMULEgzO9SvBcBAfqz/dzMYzwMt/YLszDbmGe1bcHHfFMcvGql9bf/tp+Hrj4q18aNnftGjmXTfws39emn7/5IBxog9MrmftAA5Oq4awenm8HimWO72dwVlHcHmutVMdrMHw+p2vzpzT+B0iIZ+IEpplwWhClcXlxhxAsF3CHRnnaUEqq3ByQ+cqhe5SvR4SFxh/LZoQwtj8QZQGT1BzY2EMpYnUcZWQEPlwFZw+7UryK9qV8KgruYsvyMoK16KI2sN4SOblrVwhyiL8+IBZ8cpUhsJQSU7TFHAi+L2F0sn0y+FtDODlnuif2Mba8QddPZYYxjTsIgkMe3M6+7kXxUfZvbCUlyq71J1eNczGk6Vqw6rSx2K3vM+DjLxDRGzWepTO2qTT/W8S7u0QXcyFUahcB4vq8xCYTpy8iswtnyz7Kx6lgTEQJ9RqkgEIN6DOUqB0uRdeYuDa7AP7Zy9z+ZlTsmVR5vtV71m3dmdtNeWghbr5PnPJtjXAzcvZjxyV96VEx/B1TA0IEQSI50ywGuIbmAYdQg/l/rxhQLX+6uOLyFsaUt6mtjpAJkLfehnB6MlOHnNOrWLvCBqVBS07jcM+4RzLEed3f3/0Xwp92U+nataNHyEgnnuYR6PXEjRLETz0xrt3UglfK7Bn4aNlXG7cZco4lMziLv5+Mh2JCww3mz69Z9ZMRR/xv5EKJ38IFxKd9dw5CgPIXja/gzAshMbF14/qBIgNkdUQeP8YE7SrICGtiTnAKTyA9cXa3OauDHxZOdTP7yuYBzD1UcHstIO16FxF1bRUAlSkszI83YufTchU8OPnnozDl9bS0y6CnnjGwgj9M61cXcZsljjhLeT/Vq+30ScN2PcT/dOoxUDqDS38+OpCCzLDdnwHQc3ECQVIkaxmdPaZTSdfp2jjGzSdNLM5yPQsgJDl+ZnhclDQi8ltUnkqWJ323IvTZPN8rn0+EshL1cx9PiaLTzUsryn9Zp2Nt/detUAh4N/2I3dlMQqjHFxSihv0uykzflq5clMy2ZBaxoEb0/QMp03IQQus3vnZd/NOmSsmgqXqKFP3ozyDgY7RQS+npabe/hNG+5sa5FtvL8v0uYuag2NewYkcol3TOTadpuncCnDgOGpmLnTQ1PEPUN2cNsrW8LYfIv+hzfb7vod+ipXHzmbgj5Fzc6RcT/5PD7VQ8nTJBNj1urkVUx9uJvTWmqY08OC80rGDLaWXv243VB16gjt4Xtwp5H2UDR0LiKW24Ed/sOO8jl1yEU/XAb3h7ScKnCFy/V3sICrkY1D0K9fSokHIL0s5/7DLShLAPXRbV7fbv4qj6OwHC9d5PlEOX3LRpQ3P7hcSAKlIKPDM83ypz56U5+rJeo0cyUtC7wltL8wqEiNSgZsDWzACc7RFoZqhlD0+sihIBQlkQTXmvUyIOZhkQX2zqME5VRC7ms1sa3CY+odMn3mMBiTvCMKnnCxg5ZPLq4GUDB4jF8Br2K4x4sxfWjGXQatJ25I1JyrIv2Z4bP1jKw5C+B2/s0v4dGUOsaS6IPIQV3ETQ+F2fSl2BPBXHzyYN8VmwWIrKeMX9pyGWuAOVXwkxJsRBaBVzLhZDP8ONGncknL5DpTxHN32GgFWMwsc0GmL0oRDmRT8u2lvjAKUIi0MmXhIHSlFeh3Qh5pP6ap4YUd6b569ZIaHgya2AyD12cPxY0In/PBjzDctTaKJCU+xc6m9RkNLDEE8guvxtJP8sl8N9bLqw0F/qejaBlcHYqw31zYpsutQp07hsP1vhGdl4hJ1wA7OCsAHnKj9879uSHILEmuZ6vI1lT4tvnWCVKZhhYrWHW9oPKPKpbOC6FTjf/OtUvwmiXr2ykvyLzHGQeyS7BenZpL3N/CaF5T7Gkml7JXN5cj0PKaDpZVImD61FuMgFHPqSHvt4Ej4KBdAfdcoO3AjQPLwwtKsgGM+ty4lNZMBEItJSRLunG5ckrM/BeoXWoPZVvEoIzLgFQYPupMwZCXis4W2SCJ2zsefZqCj+aTfSq1FYdUj2UeJALvVTf7vuuikOE1Hit3UIAGUi/sqgMum9vw218y1FlY/9XnOji9nqhGAcMYICc7BiqLZj5N+cKEuSAuiyWbMg81ZD1lHovy/we2eaCcCv4MzEW3O0mVA/t2xdA0cxTVbXmFhn+tARDpvDz5ftLr15OAAmvo2QiAky+feVO4bGibv2nlBmBzqx0lEDfEm4UnEs11pbnwZlJ/0Y73/wBPYfTNZiJKR73TzdCW1BffiJq9bLjQmaKnU0+gN8sfe25IKSUCooQwxePDrFn3a/zUgWxvPoTYVXfobY/GV2qqTkeVDV9D8657fhY0/wiaJ5NfLxhXbE/naxs34N0hd6vxNfdm1TCnozm/NKSCThchoYgMF7Z2tzXFovRfsNVkf86JjrM60r7UIuV3bsmfrMOqzjXjN6HPBG25zCJ3QLueySbj9oFvX/HxWBqh31PBPxduCVAxMqC9HK+YL3oBZqBruoh6LKvdMqoz0PYXUBrwbiioyE8Tj5ImjJmiOOWLbAZvIZ/l9rIPljx3T5glJ2ewlfuIT5GlodQsAf/IEtmYkML5SRQGxxwW+rlZkD8belJNu09Itwx9xDULTnemVDeojdbgcd2gKGM9aO00Jivtbs7ZyOSE8IPh98GfvatD8Ud5uHcZfAfMiPSlIxd4UqeSDzuNfbKDuFepkyC/s3j9fawmhY1b9NqDi0ZS5eP35l7rL2eK5QlWLlyCmxx8AFaFiTuD2pMUxZV5mBSJuJduOaq2ZrWpu28DE8jl/hisBz7bGWH6qLF0ayWNq1Sejtcs8KQrQqJk5P9QHDYHOIolgNsMDmEaWcTelghbfFCDqWrq6YLwDWy+m68ec5nShgq2fduUBpQUuKKKgnttaUX9PRfMmxqJyU7e0RLr1bev+ge1KK0bZyhHKKDE8gQX9Vf7rNHWOxBtZcxwwGusyMpH77qWZxXsQmbgIGhtiO+gSSRCyu/ek+OFsz1HMiQH0IHV7PjJi3dszYfFp8ue9h4+AfKte4MTiehPvxNcm/T1t9vsFZx8rHN5ie77r2jzZOq/Em4Q+H9sNcZakf9HnzCc1fJixppxP8FQABmVnqa6GbJhwaka7WH7Wdoz1WxOjSNV8N9sgW5S3Ppgkut+TTCkjA+AodUOk1KIR+8G8S3WrSZG4nyqfJ6FEjXl6a/LEoRMHZUqfPRWvwqrtXYy9IUsmUGzkqi76ib4NANCe5DnyOxnFRZ9d8FdBVBjra3iNuZhJuWW5Omi/hBigqDsg0mu2AhfJDXdwyMIJ33HHHPfS2JtjegRejX11m41TbNL+Qp7mR0g9CPKTj9PIjuSycGN/YPozXI4zarXuAeLv5CHKtKcJKRbd6R2oLNiEt0T8+QIVJH7zt9ncKMgd49vV2P1AyScZ9Qzbu3m3LBnuu6dw7aE0b6r4kzVkI/GUS88mA53L/rLtntkFlZXGtIoqNP2mD3eVv08AVVPT3wJn81zpbJV9SuqZ6Pd1ge0Zz2RFHeCdV5CLPftH9V5o9+VzFu4R0QeumqDwUhXn3IyYotdJnxr1l3BqWnQVAeDBEOtPyJQx1q5+mODiClXtYeBLTWtsJ42AMBcf/IFIhpfhYO08hsg0Ik+DpQFNOKReK3o3cudkxWX0soPtI5eSFOA6yNylS+IQjrQtYQ/5s4UcixJfokumBUjpH9ofSjUTwPCapGFndfqqG5IHeMMvfg+88SXm7bNyjk6pGKzL+WxDAdqKtQ72WWVbOk3I+ueGuammmB2pvFZvqIcU/lvW3n9+r2lycnQLE4OX9R1jIgW4cDjJ3v8dAa66mVcfC7ptCr5io6mCaA9qI9T9FFWqo1ZAaMxgxAu8aXqmaOYryMND2sTUfoHvxcYK7hEiJhCLYFDx3PBhE97c2a0ub1/ePJcyJOqr7UaTAPTJ+xvZtjb/40sloY1ltRnTkWILmIP2b7S3AdXCR+YiArMUHwdncpjpyDGfzqGOUoAuaamWzAMacQtb34/M32FEgR5lUEf8fRzFrZUhzQj0fR7/6gdzdnVVvcSneLmtqJ930VCCDORY8CVdQWdo/S3PNkX3pQsPVKWIYGAMrFZoq8bQ/OJBDSXP7KSBdL3QN0Zqd393p6VFc7DnlnFiN00SY5Nux7yadeIM0Upl2rVsu8/VAI";
var FENCED = /* @__PURE__ */ new Map([[8217, "apostrophe"], [8260, "fraction slash"], [12539, "middle dot"]]);
var NSM_MAX = 4;
function decode_arithmetic(bytes2) {
  let pos = 0;
  function u16() {
    return bytes2[pos++] << 8 | bytes2[pos++];
  }
  let symbol_count = u16();
  let total = 1;
  let acc = [0, 1];
  for (let i = 1; i < symbol_count; i++) {
    acc.push(total += u16());
  }
  let skip = u16();
  let pos_payload = pos;
  pos += skip;
  let read_width = 0;
  let read_buffer = 0;
  function read_bit() {
    if (read_width == 0) {
      read_buffer = read_buffer << 8 | bytes2[pos++];
      read_width = 8;
    }
    return read_buffer >> --read_width & 1;
  }
  const N2 = 31;
  const FULL = 2 ** N2;
  const HALF = FULL >>> 1;
  const QRTR = HALF >> 1;
  const MASK = FULL - 1;
  let register = 0;
  for (let i = 0; i < N2; i++)
    register = register << 1 | read_bit();
  let symbols = [];
  let low = 0;
  let range = FULL;
  while (true) {
    let value = Math.floor(((register - low + 1) * total - 1) / range);
    let start = 0;
    let end = symbol_count;
    while (end - start > 1) {
      let mid = start + end >>> 1;
      if (value < acc[mid]) {
        end = mid;
      } else {
        start = mid;
      }
    }
    if (start == 0)
      break;
    symbols.push(start);
    let a = low + Math.floor(range * acc[start] / total);
    let b2 = low + Math.floor(range * acc[start + 1] / total) - 1;
    while (((a ^ b2) & HALF) == 0) {
      register = register << 1 & MASK | read_bit();
      a = a << 1 & MASK;
      b2 = b2 << 1 & MASK | 1;
    }
    while (a & ~b2 & QRTR) {
      register = register & HALF | register << 1 & MASK >>> 1 | read_bit();
      a = a << 1 ^ HALF;
      b2 = (b2 ^ HALF) << 1 | HALF | 1;
    }
    low = a;
    range = 1 + b2 - a;
  }
  let offset = symbol_count - 4;
  return symbols.map((x) => {
    switch (x - offset) {
      case 3:
        return offset + 65792 + (bytes2[pos_payload++] << 16 | bytes2[pos_payload++] << 8 | bytes2[pos_payload++]);
      case 2:
        return offset + 256 + (bytes2[pos_payload++] << 8 | bytes2[pos_payload++]);
      case 1:
        return offset + bytes2[pos_payload++];
      default:
        return x - 1;
    }
  });
}
function read_payload(v) {
  let pos = 0;
  return () => v[pos++];
}
function read_compressed_payload(s) {
  return read_payload(decode_arithmetic(unsafe_atob(s)));
}
function unsafe_atob(s) {
  let lookup = [];
  [..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].forEach((c, i) => lookup[c.charCodeAt(0)] = i);
  let n2 = s.length;
  let ret = new Uint8Array(6 * n2 >> 3);
  for (let i = 0, pos = 0, width = 0, carry = 0; i < n2; i++) {
    carry = carry << 6 | lookup[s.charCodeAt(i)];
    width += 6;
    if (width >= 8) {
      ret[pos++] = carry >> (width -= 8);
    }
  }
  return ret;
}
function signed(i) {
  return i & 1 ? ~i >> 1 : i >> 1;
}
function read_deltas(n2, next) {
  let v = Array(n2);
  for (let i = 0, x = 0; i < n2; i++)
    v[i] = x += signed(next());
  return v;
}
function read_sorted(next, prev = 0) {
  let ret = [];
  while (true) {
    let x = next();
    let n2 = next();
    if (!n2)
      break;
    prev += x;
    for (let i = 0; i < n2; i++) {
      ret.push(prev + i);
    }
    prev += n2 + 1;
  }
  return ret;
}
function read_sorted_arrays(next) {
  return read_array_while(() => {
    let v = read_sorted(next);
    if (v.length)
      return v;
  });
}
function read_mapped(next) {
  let ret = [];
  while (true) {
    let w = next();
    if (w == 0)
      break;
    ret.push(read_linear_table(w, next));
  }
  while (true) {
    let w = next() - 1;
    if (w < 0)
      break;
    ret.push(read_replacement_table(w, next));
  }
  return ret.flat();
}
function read_array_while(next) {
  let v = [];
  while (true) {
    let x = next(v.length);
    if (!x)
      break;
    v.push(x);
  }
  return v;
}
function read_transposed(n2, w, next) {
  let m = Array(n2).fill().map(() => []);
  for (let i = 0; i < w; i++) {
    read_deltas(n2, next).forEach((x, j) => m[j].push(x));
  }
  return m;
}
function read_linear_table(w, next) {
  let dx = 1 + next();
  let dy = next();
  let vN = read_array_while(next);
  let m = read_transposed(vN.length, 1 + w, next);
  return m.flatMap((v, i) => {
    let [x, ...ys] = v;
    return Array(vN[i]).fill().map((_, j) => {
      let j_dy = j * dy;
      return [x + j * dx, ys.map((y) => y + j_dy)];
    });
  });
}
function read_replacement_table(w, next) {
  let n2 = 1 + next();
  let m = read_transposed(n2, 1 + w, next);
  return m.map((v) => [v[0], v.slice(1)]);
}
function read_trie(next) {
  let ret = [];
  let sorted = read_sorted(next);
  expand(decode2([]), []);
  return ret;
  function decode2(Q) {
    let S2 = next();
    let B = read_array_while(() => {
      let cps = read_sorted(next).map((i) => sorted[i]);
      if (cps.length)
        return decode2(cps);
    });
    return { S: S2, B, Q };
  }
  function expand({ S: S2, B }, cps, saved) {
    if (S2 & 4 && saved === cps[cps.length - 1])
      return;
    if (S2 & 2)
      saved = cps[cps.length - 1];
    if (S2 & 1)
      ret.push(cps);
    for (let br of B) {
      for (let cp of br.Q) {
        expand(br, [...cps, cp], saved);
      }
    }
  }
}
function hex_cp(cp) {
  return cp.toString(16).toUpperCase().padStart(2, "0");
}
function quote_cp(cp) {
  return `{${hex_cp(cp)}}`;
}
function explode_cp(s) {
  let cps = [];
  for (let pos = 0, len = s.length; pos < len; ) {
    let cp = s.codePointAt(pos);
    pos += cp < 65536 ? 1 : 2;
    cps.push(cp);
  }
  return cps;
}
function str_from_cps(cps) {
  const chunk = 4096;
  let len = cps.length;
  if (len < chunk)
    return String.fromCodePoint(...cps);
  let buf = [];
  for (let i = 0; i < len; ) {
    buf.push(String.fromCodePoint(...cps.slice(i, i += chunk)));
  }
  return buf.join("");
}
function compare_arrays(a, b2) {
  let n2 = a.length;
  let c = n2 - b2.length;
  for (let i = 0; c == 0 && i < n2; i++)
    c = a[i] - b2[i];
  return c;
}
var COMPRESSED = "AEUDWAHSCGYATwDVADIAdgAiADQAFAAtABQAIQAPACcADQASAAsAGQAJABIACQARAAUACwAFAAwABQAQAAMABwAEAAoABQAJAAIACgABAAQAFAALAAIACwABAAIAAQAHAAMAAwAEAAsADAAMAAwACwANAA0AAwAKAAkABAAdAAYAZwDTAecDNACxCmIB8xhZAqfoC190UGcThgBurwf7PT09Pb09AjgJum8OjDllxHYUKXAPxzq6tABAxgK8ysUvWAgMPT09PT09PSs6LT2HcgWXWwFLoSMEEEl5RFVMKvO0XQ8ExDdJMnIgPi89uj00MsvBXxEPAGPCDwBnQKoEbwRwBHEEcgRzBHQEdQR2BHcEeAR6BHsEfAR+BIAEgfndBQoBYgULAWIFDAFiBNcE2ATZBRAFEQUvBdALFAsVDPcNBw13DYcOMA4xDjMB4BllHI0B2grbAMDpHLkQ7QHVAPRNQQFnGRUEg0yEB2uaJEMAJpIBpob5AERSMAKNoAXqaQLRBMCzEiC+AZ4EWRJJFbEu7QDQLARtEbgECxDwAb/RyAk1AV4nD2cEQQKTAzsAGpobPgAahAGPCrysdy0OAKwAfFIcBAQFUmoA/PtZADkBIadVj2UMUgx5Il4ANQC9vLIBDAHUGVsQ8wCzfQIbGVcCHBZHAZ8CBAgXOhG7AqMZ4M7+1M0UAPDNAWsC+mcJDe8AAQA99zkEXLICyQozAo6lAobcP5JvjQLFzwKD9gU/OD8FEQCtEQL6bW+nAKUEvzjDHsuRyUvOFHcacUz5AqIFRSE2kzsBEQCuaQL5DQTlcgO6twSpTiUgCwIFCAUXBHQEqQV6swAVxUlmTmsCwjqsP/wKJQmXb793UgZBEBsnpRD3DDMBtQE7De1L2ATxBjsEyR99GRkPzZWcCKUt3QztJuMuoYBaI/UqgwXtS/Q83QtNUWgPWQtlCeM6Y4FOAyEBDSKLCt0NOQhtEPMKyWsN5RFFBzkD1UmaAKUHAQsRHTUVtSYQYqwLCTl3Bvsa9guPJq8TKXr8BdMaIQZNASka/wDPLueFsFoxXBxPXwYDCyUjxxSoUCANJUC3eEgaGwcVJakCkUNwSodRNh6TIfY8PQ1mLhNRfAf1PAUZTwuBPJ5Gq0UOEdI+jT1IIklMLAQ1fywvJ4sJzw+FDLl8cgFZCSEJsQxxEzERFzfFCDkHGS2XJCcVCCFGlWCaBPefA/MT0QMLBT8JQQcTA7UcLRMuFSkFDYEk1wLzNtUuswKPVoABFwXLDyUf3xBQR+AO6QibAmUDgyXrAC0VIQAXIpsIQ2MAX4/YUwUuywjHamwjdANnFOdhEXMHkQ5XB6ccMxW/HOFwyF4Lhggoo68JWwF1CZkBXwTjCAk1W4ygIEFnU4tYGJsgYUE/XfwCMQxlFZ9EvYd4AosPaxIbATUBcwc5DQECdxHtEWsQlQjrhgQ1tTP4OiUETyGDIBEKJwNPbM4LJyb5DPhpAaMSYgMMND137merYLYkF/0HGTLFQWAh8QuST80MnBrBGEJULhnkB78D8xrzJ+pBVwX/A6MDEzpNM+4EvQtpCIsJPwBJDqMXB9cYagpxjNABMYsBt5kDV5GDAm+PBjcHCwBnC4cFeeUAHQKnCKMABQDPA1cAOQKtB50AGQCFQQE9AycvASHlAo8DkwgxywGVLwHzKQQbwwwVAPc3bkoCw7ECgGpmogXdWAKOAkk1AU0lBAVOR1EDr3HhANsASwYT30cBFatKyxrjQwHfbysAxwD7AAU1BwVBAc0B820AtwFfCzEJorO1AU3pKQCDABVrAdcCiQDdADUAf/EBUwBNBVn5BdMCT0kBETEYK1dhAbsDHwEzAQ0AeQbLjaXJBx8EbQfTAhAbFeEC7y4HtQEDIt8TzULFAr3eVaFgAmSBAmJCW02vWzcgAqH3AmiYAmYJAp+EOBsLAmY7AmYmBG4EfwN/EwN+kjkGOXcXOYI6IyMCbB0CMjY4CgJtxwJtru+KM2dFKwFnAN4A4QBKBQeYDI0A/gvCAA21AncvAnaiPwJ5S0MCeLodXNtFrkbXAnw/AnrIAn0JAnzwBVkFIEgASH1jJAKBbQKAAAKABQJ/rklYSlsVF0rMAtEBAtDMSycDiE8Dh+ZExZEyAvKhXQMDA65LzkwtJQPPTUxNrwKLPwKK2MEbBx1DZwW3Ao43Ao5cQJeBAo7ZAo5ceFG0UzUKUtRUhQKT+wKTDADpABxVHlWvVdAGLBsplYYy4XhmRTs5ApefAu+yWCGoAFklApaPApZ8nACpWaxaCYFNADsClrUClk5cRFzRApnLAplkXMpdBxkCnJs5wjqdApwWAp+bAp64igAdDzEqDwKd8QKekgC1PWE0Ye8CntMCoG4BqQKenx8Cnk6lY8hkJyUrAievAiZ+AqD7AqBMAqLdAqHEAqYvAqXOAqf/AH0Cp/JofGixAANJahxq0QKs4wKsrgKtZwKtAgJXHQJV3AKx4dcDH05slwKyvQ0CsugXbOBtY21IXwMlzQK2XDs/bpADKUUCuF4CuUcVArkqd3A2cOECvRkCu9pwlgMyEQK+iHICAzNxAr4acyJzTwLDywLDBHOCdEs1RXTgAzynAzyaAz2/AsV8AsZHAsYQiQLIaVECyEQCyU8CyS4CZJ0C3dJ4eWF4rnklS9ADGKNnAgJh9BnzlSR7C16SXrsRAs9rAs9sL0tT0vMTnwDGrQLPcwEp6gNOEn5LBQLcJwLbigLSTwNSXANTXwEBA1WMgIk/AMsW7WBFghyC04LOg40C2scC2d6EEIRJpzwDhqUALwNkDoZxWfkAVQLfZQLeuHN3AuIv7RQB8zAnAfSbAfLShwLr8wLpcHkC6vkC6uQA+UcBuQLuiQLrnJaqlwMC7j8DheCYeXDgcaEC8wMAaQOOFpmTAvcTA5FuA5KHAveYAvnZAvhmmhyaq7s3mx4DnYMC/voBGwA5nxyfswMFjQOmagOm2QDRxQMGaqGIogUJAwxJAtQAPwMA4UEXUwER8wNrB5dnBQCTLSu3r73bAYmZFH8RBDkB+ykFIQ6dCZ8Akv0TtRQrxQL3LScApQC3BbmOkRc/xqdtQS4UJo0uAUMBgPwBtSYAdQMOBG0ALAIWDKEAAAoCPQJqA90DfgSRASBFBSF8CgAFAEQAEwA2EgJ3AQAF1QNr7wrFAgD3Cp8nv7G35QGRIUFCAekUfxE0wIkABAAbAFoCRQKEiwAGOlM6lI1tALg6jzrQAI04wTrcAKUA6ADLATqBOjs5/Dn5O3aJOls7nok6bzkYAVYBMwFsBS81XTWeNa01ZjV1NbY1xTWCNZE10jXhNZ41rTXuNf01sjXBNgI2ETXGNdU2FjYnNd417TYuNj02LjUtITY6Nj02PDbJNwgEkDxXNjg23TcgNw82yiA3iTcwCgSwPGc2JDcZN2w6jTchQtRDB0LgQwscDw8JmyhtKFFVBgDpfwDpsAD+mxQ91wLpNSMArQC9BbeOkRdLxptzBL8MDAMMAQgDAAkKCwsLCQoGBAVVBI/DvwDz9b29kaUCb0QtsRTNLt4eGBcSHAMZFhYZEhYEARAEBUEcQRxBHEEcQRxBHEEaQRxBHEFCSTxBPElISUhBNkM2QTYbNklISVmBVIgELgEaJZkC7aMAoQCjBcGOmxdNxrsBvwGJAaQcEZ0ePCklMAAhMvAIMAL54gC7Bm8EescjzQMpARQpKgDUHqSvAj5Gqwr7YrMUACT9AN3rpF27H7fsd/twPt4l+UW1yQYKBt2Cgy7qJpGiLcdE2P1cQSImUbqJ6ICH27H4knQMIRMrFkHu3sx6tC35Y+eLIh4e4CMKJ4DfyV+8mfta499RCAJ0xfeZR8PsoYOApva9pjGn4PhvyZS7/h5JLuhaucfjuU+Z584wwqNO4hWYmaBCcjgQPale1bjoHzMUbut/zTgxHxBnAyrdKpF4IRMASLBtD/jviyLeCgj8twWjAd3HchN/uqaeRYeHJgl7JEY9/cTrvtfybx/r3Y/NtxJ9dp+MTVmiS9bwBH73s8Di56/Ma+mTPMHq4T1yEG1fWcqr0u+hrGnJEvU1JJAm/maQSrKrazIyvSkDFkj8UUlfBq8baniTGPng6YZRL661rDNw4w/1g2figG0IhXnL7wosd/sVNo5dYSmMBTP5c7rYLjRdCwg8quwljOMPf63D8ICAL0r71XRiyFHdgwHbwfgnPOf4Lzjf2v+j+IiDHG2isp5yUnzSDyDRb4i/Vs0qHSHq8PiEQ/JnBP7PxnjN0j6gT4AVAeRx/1o9VnEUlUwvFrzJqHk9jxAw4sYxCnrxaeBdCFFKbnE7z+x54F5W7ZZsU6kx8Qocul6FoAHHy01FGL/nne61mn4+uYXfQ1Uccn+HMLKE+cZzT8BB1E3FRskOgJrRsq25rauLm8+uamXpkS/bTy6y1wDbCrW4eD532kTWrtNUmVVZOIn/C+/JR9KVR5iG9TY8iaT67ubm/whL1xbKZoqtY+a6fNxMJrg211bGYJDUkYMNWA0BMB++9zOm6Eik4roqs9CCEFW0lyAK0PbvlzvoxrZuY/OEhNW/l/63U15Od/RSvmDvXpGLiVmeGi5PDSH2bYz5o2g6wFDQ2FbZgYgTF8rPlvA1ifjZD3NLtFdXdpSIJvgKR7GpjJWG7GZGawPomIH8B5tUmtHH9LpM+/KQKunEPa1GiQkCXv4Cnm9DLORo2joicHdPDZ64obQrPZ5bgqckkj0G6/NEiPYBY4bCkL7W8G5YzsUb6GakFjykSPkT7JGeLeB6uJOGMm+x7N381BCDfbJFx0dtLgV9Q477BfL1fvitX5anV/oYfxeYl+eF5x5bB8+Ep/L2nsmd56aKF4aAD4GbJWsdKyBW22xEmAD3XdbtsMyAFoR5mOla0gEd9U/YVB7zvHGpHbQonay9Sv0bQ8iZ8piaXVrKc5AG1AmqqgaEvzHSP2Wux7aZTWh6quVDVU01JtMIVRdCFwlSbbqqhoFlyzsotQzRexFvZ/MqUSFu3OhRIuNBbufvBpdVgb8XdGJ48/lJPCZ7dsOujTTbKPSEvGXkOnG2Xdi8/nM3EMRqITd5QeU7iOjKqC7URJY6TnLsHij22xAHKnVRD5MDtBYnoGFqZGMDmXCW6Oj+BAWw14hESY/xLF6bLku06AHkiXTHPCFZ0f9YSqqo27eAhhS67OrA2Het4M9JM3jm/yRX6bYxnfmzYl5qQdHxN08FsNuWDrWd4vMUY2QD3hr8vS73SCTkFoXZR3xNzOQt8d/6HfjBmXqvrE6EGkLzK6YK2U2/ksU/iUH+LvVIsJI+ri2AL/klo+ShdDyfs5A83i2prkMs51IKR7ZcqjZJi5X3+bd8GlyWvtddxKEoEqSgEO7A8jIgf2nH0h8FjM7oB6yte3X5mpL0i/E4Rx0CotKnILJj/vJqo4VkPQ93jRtRVfaitQPqldl5xRYPq8387Z0DcnZvOeION0Ht1+P27kFLGQIcLBX4FG3sffccNHh5cPfzp9INoRtqVtdViJfg8RjnXiIz/MNqEN6zvzX3hMzyWC7oSoXIT14ubc0abPX8Rp9GVa5NI/8iv+6ela1oTncbdimRKnrbRffDR/X4nH+bgqAuHWl7hOaeXPWVzIeRl7ga+JzD4Sx3mlj/q6Ra/E2HhDf21eEzTLNGfCZsY+/yxZzQzIAuijG65ii4O/waAJCrEJaWd/DRAKMQ5678Dw5AT7RCKzdadIwd8LsD+DgPBASmWsUlf8R0k1w/2k4lO2Wpb4zMI6EJVJs0xk/wn8/fRUPqrDKhbjHR41SqgFMx5RGMPuduFwlu5lK89tW11sTqiX/5EfGs5nO+y9FKvgXKPOEmgE05EKNL6Sjb3xS40H3BVPhm0ESOZgAjZoymc8be0inDVo4JdJVf+NKd3tN/CaB7GShhH27qf95NoFZVX/6ZkR2lX+CgWrQ2INgkh+bbMz68+uJ3Clsh8HSMPEQtAt+BBE6fXDab7KIlsKxU1lIXW/KWVstpdPanJ0pdXpQinDyUQjtY7ZVcfiecRxRDMAUhHFU2cEaciQ+htiPMPx1kdvtWG9T44w3r037ljHBFJdYR0r55qvMRixtAEFJAqA4T1ES87FAx7UozXasytg8MftZYt0rjYgLe6EJ5aWvy2qscBSBQ7yehoJIA3wIIZ9ukfkyBb6qnue5ko8W50rpV4kXqWjI5nbGRXrNW0tBZHXlY48nSgcUXBHWT4GcgLZJoLlKJnV96kCYpq9eWHh7xJzkCAyrQuQ5AJ0qq/uZ3toJglNterev+Qm0KXxPg/+YbFRJdfhbp1wOnVOEYdVHTya6CtO0afhEaBhx3oHwCb5Kq6RwHDzFMl2vfjL8GwzcCoTj7wZe+UFnYDV2yKpPU9dba29gYBdNqJg/KXozO+CJTlKmlKhnqTf5doeS35DZFV+cYJQVjd+oVY/Gtc/6XPzUxb1gMqf6cEjNNoRC8AObrp+fx0cVtGu4ffC2TgXRC8zPl8moUHCB5HZ25d87mlsiiK0aNwBtcEQjRNBT/QrXbw/8aVXdKMHn9EqYEKEyxSGTpYQOaes1G1Qq8pDgqkZtlO2HRyCXpmeM7TSrRPkAh004BfisVpF6zP44n2Jvxz/gOVocNCyy9V6lkod28QM4pbaMvVJigD/w3BrsjSJrXlqc4ulBYOCceiBN4b/gHajYyupbhEt63a619Ay4wsL6a6w6B+A7TnoyE7BliWHJfzVxxIKM/W3M/J8Bx99Op863Q8eNuIMGRx++VbYfjm+VGYBA3Ap/KEu/wxBNBpJJncwHPG45V8Gh98ZIrGCc20MwijGowZbcS7d1nEgcOW5cddZpHL2XPAIRbColiheZzXTvBxZOY3iMSDSKDrICyJ/iQs1vdplVdH/JrLJsQ2jtTnfCrITIghq3KFX3qAgLWAIp8IffNSdTYptnbGfc8s+qcr3zyzyHp1aJg+jxTF4kD1ry5Wauv5V3xnOGwTFecNzXSLHBW20/pCQjk4uorD0plIhMSTc79+/r4RKPClRYTBYex1Ob5crtfvRQBBv6re/6FhtCqtduag67glqRA77/3ulblh9YRtMdDxkCyJDeNnAuCLPQFmdRRWJtH20Z8DstfJf+5oj5SSB64d0iF5/Ya4KfTWxfivj9Ap2/zbYaTo/1gO3tM6RYsCZharMBFr7Fm61mLSrQnEI4OF1gbVS4k/JE9UotOrnLJZuswoWodCSV8zbybkJSVIP7n8UaE9xCR39rJZmf27HOAPVOGc9pdkQUcRrI0qyVF9Z3j1RHDbxIfwbWzmPVjwIdPJvtmBYwEQIUsIW1S939hcVikK00ozPRI02cqhzVUNzpOxVdrwRPvlh1aIOf0xFEqD3YkGnCnFah/cFN3J2gB7N+bZSGawwkKFu1tpQMrp1W+27YNkyT0TpcFpTqgOqqLabrgcCUPxh97mREOGy4xItzQ9xSl6rq+8BZsHcrQFReS+QeMxJ3P6CnL9EP/eOLDjumLhvrcQrpPiknsofbzBv9gTP0lU+TIVwE6E7CcKfT36q+ZiEOHJ9ayf0dyUJLezAb2M8aNHwd0+OJmsVgTzRWA";
var S0 = 44032;
var L0 = 4352;
var V0 = 4449;
var T0 = 4519;
var L_COUNT = 19;
var V_COUNT = 21;
var T_COUNT = 28;
var N_COUNT = V_COUNT * T_COUNT;
var S_COUNT = L_COUNT * N_COUNT;
var S1 = S0 + S_COUNT;
var L1 = L0 + L_COUNT;
var V1 = V0 + V_COUNT;
var T1 = T0 + T_COUNT;
function unpack_cc(packed) {
  return packed >> 24 & 255;
}
function unpack_cp(packed) {
  return packed & 16777215;
}
var SHIFTED_RANK;
var EXCLUSIONS;
var DECOMP;
var RECOMP;
function init$1() {
  let r = read_compressed_payload(COMPRESSED);
  SHIFTED_RANK = new Map(read_sorted_arrays(r).flatMap((v, i) => v.map((x) => [x, i + 1 << 24])));
  EXCLUSIONS = new Set(read_sorted(r));
  DECOMP = /* @__PURE__ */ new Map();
  RECOMP = /* @__PURE__ */ new Map();
  for (let [cp, cps] of read_mapped(r)) {
    if (!EXCLUSIONS.has(cp) && cps.length == 2) {
      let [a, b2] = cps;
      let bucket = RECOMP.get(a);
      if (!bucket) {
        bucket = /* @__PURE__ */ new Map();
        RECOMP.set(a, bucket);
      }
      bucket.set(b2, cp);
    }
    DECOMP.set(cp, cps.reverse());
  }
}
function is_hangul(cp) {
  return cp >= S0 && cp < S1;
}
function compose_pair(a, b2) {
  if (a >= L0 && a < L1 && b2 >= V0 && b2 < V1) {
    return S0 + (a - L0) * N_COUNT + (b2 - V0) * T_COUNT;
  } else if (is_hangul(a) && b2 > T0 && b2 < T1 && (a - S0) % T_COUNT == 0) {
    return a + (b2 - T0);
  } else {
    let recomp = RECOMP.get(a);
    if (recomp) {
      recomp = recomp.get(b2);
      if (recomp) {
        return recomp;
      }
    }
    return -1;
  }
}
function decomposed(cps) {
  if (!SHIFTED_RANK)
    init$1();
  let ret = [];
  let buf = [];
  let check_order = false;
  function add(cp) {
    let cc = SHIFTED_RANK.get(cp);
    if (cc) {
      check_order = true;
      cp |= cc;
    }
    ret.push(cp);
  }
  for (let cp of cps) {
    while (true) {
      if (cp < 128) {
        ret.push(cp);
      } else if (is_hangul(cp)) {
        let s_index = cp - S0;
        let l_index = s_index / N_COUNT | 0;
        let v_index = s_index % N_COUNT / T_COUNT | 0;
        let t_index = s_index % T_COUNT;
        add(L0 + l_index);
        add(V0 + v_index);
        if (t_index > 0)
          add(T0 + t_index);
      } else {
        let mapped = DECOMP.get(cp);
        if (mapped) {
          buf.push(...mapped);
        } else {
          add(cp);
        }
      }
      if (!buf.length)
        break;
      cp = buf.pop();
    }
  }
  if (check_order && ret.length > 1) {
    let prev_cc = unpack_cc(ret[0]);
    for (let i = 1; i < ret.length; i++) {
      let cc = unpack_cc(ret[i]);
      if (cc == 0 || prev_cc <= cc) {
        prev_cc = cc;
        continue;
      }
      let j = i - 1;
      while (true) {
        let tmp = ret[j + 1];
        ret[j + 1] = ret[j];
        ret[j] = tmp;
        if (!j)
          break;
        prev_cc = unpack_cc(ret[--j]);
        if (prev_cc <= cc)
          break;
      }
      prev_cc = unpack_cc(ret[i]);
    }
  }
  return ret;
}
function composed_from_decomposed(v) {
  let ret = [];
  let stack = [];
  let prev_cp = -1;
  let prev_cc = 0;
  for (let packed of v) {
    let cc = unpack_cc(packed);
    let cp = unpack_cp(packed);
    if (prev_cp == -1) {
      if (cc == 0) {
        prev_cp = cp;
      } else {
        ret.push(cp);
      }
    } else if (prev_cc > 0 && prev_cc >= cc) {
      if (cc == 0) {
        ret.push(prev_cp, ...stack);
        stack.length = 0;
        prev_cp = cp;
      } else {
        stack.push(cp);
      }
      prev_cc = cc;
    } else {
      let composed = compose_pair(prev_cp, cp);
      if (composed >= 0) {
        prev_cp = composed;
      } else if (prev_cc == 0 && cc == 0) {
        ret.push(prev_cp);
        prev_cp = cp;
      } else {
        stack.push(cp);
        prev_cc = cc;
      }
    }
  }
  if (prev_cp >= 0) {
    ret.push(prev_cp, ...stack);
  }
  return ret;
}
function nfd(cps) {
  return decomposed(cps).map(unpack_cp);
}
function nfc(cps) {
  return composed_from_decomposed(decomposed(cps));
}
var HYPHEN = 45;
var STOP_CH = ".";
var FE0F = 65039;
var UNIQUE_PH = 1;
var Array_from = (x) => Array.from(x);
function group_has_cp(g, cp) {
  return g.P.has(cp) || g.Q.has(cp);
}
var Emoji = class extends Array {
  get is_emoji() {
    return true;
  }
  // free tagging system
};
var MAPPED;
var IGNORED;
var CM;
var NSM;
var ESCAPE;
var NFC_CHECK;
var GROUPS;
var WHOLE_VALID;
var WHOLE_MAP;
var VALID;
var EMOJI_LIST;
var EMOJI_ROOT;
function init() {
  if (MAPPED)
    return;
  let r = read_compressed_payload(COMPRESSED$1);
  const read_sorted_array = () => read_sorted(r);
  const read_sorted_set = () => new Set(read_sorted_array());
  const set_add_many = (set, v) => v.forEach((x) => set.add(x));
  MAPPED = new Map(read_mapped(r));
  IGNORED = read_sorted_set();
  CM = read_sorted_array();
  NSM = new Set(read_sorted_array().map((i) => CM[i]));
  CM = new Set(CM);
  ESCAPE = read_sorted_set();
  NFC_CHECK = read_sorted_set();
  let chunks = read_sorted_arrays(r);
  let unrestricted = r();
  const read_chunked = () => {
    let set = /* @__PURE__ */ new Set();
    read_sorted_array().forEach((i) => set_add_many(set, chunks[i]));
    set_add_many(set, read_sorted_array());
    return set;
  };
  GROUPS = read_array_while((i) => {
    let N2 = read_array_while(r).map((x) => x + 96);
    if (N2.length) {
      let R = i >= unrestricted;
      N2[0] -= 32;
      N2 = str_from_cps(N2);
      if (R)
        N2 = `Restricted[${N2}]`;
      let P = read_chunked();
      let Q = read_chunked();
      let M = !r();
      return { N: N2, P, Q, M, R };
    }
  });
  WHOLE_VALID = read_sorted_set();
  WHOLE_MAP = /* @__PURE__ */ new Map();
  let wholes = read_sorted_array().concat(Array_from(WHOLE_VALID)).sort((a, b2) => a - b2);
  wholes.forEach((cp, i) => {
    let d = r();
    let w = wholes[i] = d ? wholes[i - d] : { V: [], M: /* @__PURE__ */ new Map() };
    w.V.push(cp);
    if (!WHOLE_VALID.has(cp)) {
      WHOLE_MAP.set(cp, w);
    }
  });
  for (let { V, M } of new Set(WHOLE_MAP.values())) {
    let recs = [];
    for (let cp of V) {
      let gs = GROUPS.filter((g) => group_has_cp(g, cp));
      let rec = recs.find(({ G }) => gs.some((g) => G.has(g)));
      if (!rec) {
        rec = { G: /* @__PURE__ */ new Set(), V: [] };
        recs.push(rec);
      }
      rec.V.push(cp);
      set_add_many(rec.G, gs);
    }
    let union = recs.flatMap((x) => Array_from(x.G));
    for (let { G, V: V2 } of recs) {
      let complement = new Set(union.filter((g) => !G.has(g)));
      for (let cp of V2) {
        M.set(cp, complement);
      }
    }
  }
  VALID = /* @__PURE__ */ new Set();
  let multi = /* @__PURE__ */ new Set();
  const add_to_union = (cp) => VALID.has(cp) ? multi.add(cp) : VALID.add(cp);
  for (let g of GROUPS) {
    for (let cp of g.P)
      add_to_union(cp);
    for (let cp of g.Q)
      add_to_union(cp);
  }
  for (let cp of VALID) {
    if (!WHOLE_MAP.has(cp) && !multi.has(cp)) {
      WHOLE_MAP.set(cp, UNIQUE_PH);
    }
  }
  set_add_many(VALID, nfd(VALID));
  EMOJI_LIST = read_trie(r).map((v) => Emoji.from(v)).sort(compare_arrays);
  EMOJI_ROOT = /* @__PURE__ */ new Map();
  for (let cps of EMOJI_LIST) {
    let prev = [EMOJI_ROOT];
    for (let cp of cps) {
      let next = prev.map((node) => {
        let child = node.get(cp);
        if (!child) {
          child = /* @__PURE__ */ new Map();
          node.set(cp, child);
        }
        return child;
      });
      if (cp === FE0F) {
        prev.push(...next);
      } else {
        prev = next;
      }
    }
    for (let x of prev) {
      x.V = cps;
    }
  }
}
function quoted_cp(cp) {
  return (should_escape(cp) ? "" : `${bidi_qq(safe_str_from_cps([cp]))} `) + quote_cp(cp);
}
function bidi_qq(s) {
  return `"${s}"\u200E`;
}
function check_label_extension(cps) {
  if (cps.length >= 4 && cps[2] == HYPHEN && cps[3] == HYPHEN) {
    throw new Error(`invalid label extension: "${str_from_cps(cps.slice(0, 4))}"`);
  }
}
function check_leading_underscore(cps) {
  const UNDERSCORE = 95;
  for (let i = cps.lastIndexOf(UNDERSCORE); i > 0; ) {
    if (cps[--i] !== UNDERSCORE) {
      throw new Error("underscore allowed only at start");
    }
  }
}
function check_fenced(cps) {
  let cp = cps[0];
  let prev = FENCED.get(cp);
  if (prev)
    throw error_placement(`leading ${prev}`);
  let n2 = cps.length;
  let last = -1;
  for (let i = 1; i < n2; i++) {
    cp = cps[i];
    let match = FENCED.get(cp);
    if (match) {
      if (last == i)
        throw error_placement(`${prev} + ${match}`);
      last = i + 1;
      prev = match;
    }
  }
  if (last == n2)
    throw error_placement(`trailing ${prev}`);
}
function safe_str_from_cps(cps, max = Infinity, quoter = quote_cp) {
  let buf = [];
  if (is_combining_mark(cps[0]))
    buf.push("\u25CC");
  if (cps.length > max) {
    max >>= 1;
    cps = [...cps.slice(0, max), 8230, ...cps.slice(-max)];
  }
  let prev = 0;
  let n2 = cps.length;
  for (let i = 0; i < n2; i++) {
    let cp = cps[i];
    if (should_escape(cp)) {
      buf.push(str_from_cps(cps.slice(prev, i)));
      buf.push(quoter(cp));
      prev = i + 1;
    }
  }
  buf.push(str_from_cps(cps.slice(prev, n2)));
  return buf.join("");
}
function is_combining_mark(cp, only_nsm) {
  init();
  return only_nsm ? NSM.has(cp) : CM.has(cp);
}
function should_escape(cp) {
  init();
  return ESCAPE.has(cp);
}
function ens_normalize(name) {
  return flatten(split2(name, nfc, filter_fe0f));
}
function split2(name, nf, ef) {
  if (!name)
    return [];
  init();
  let offset = 0;
  return name.split(STOP_CH).map((label) => {
    let input = explode_cp(label);
    let info = {
      input,
      offset
      // codepoint, not substring!
    };
    offset += input.length + 1;
    try {
      let tokens = info.tokens = tokens_from_str(input, nf, ef);
      let token_count = tokens.length;
      let type;
      if (!token_count) {
        throw new Error(`empty label`);
      }
      let norm = info.output = tokens.flat();
      check_leading_underscore(norm);
      let emoji = info.emoji = token_count > 1 || tokens[0].is_emoji;
      if (!emoji && norm.every((cp) => cp < 128)) {
        check_label_extension(norm);
        type = "ASCII";
      } else {
        let chars = tokens.flatMap((x) => x.is_emoji ? [] : x);
        if (!chars.length) {
          type = "Emoji";
        } else {
          if (CM.has(norm[0]))
            throw error_placement("leading combining mark");
          for (let i = 1; i < token_count; i++) {
            let cps = tokens[i];
            if (!cps.is_emoji && CM.has(cps[0])) {
              throw error_placement(`emoji + combining mark: "${str_from_cps(tokens[i - 1])} + ${safe_str_from_cps([cps[0]])}"`);
            }
          }
          check_fenced(norm);
          let unique = Array_from(new Set(chars));
          let [g] = determine_group(unique);
          check_group(g, chars);
          check_whole(g, unique);
          type = g.N;
        }
      }
      info.type = type;
    } catch (err) {
      info.error = err;
    }
    return info;
  });
}
function check_whole(group, unique) {
  let maker;
  let shared = [];
  for (let cp of unique) {
    let whole = WHOLE_MAP.get(cp);
    if (whole === UNIQUE_PH)
      return;
    if (whole) {
      let set = whole.M.get(cp);
      maker = maker ? maker.filter((g) => set.has(g)) : Array_from(set);
      if (!maker.length)
        return;
    } else {
      shared.push(cp);
    }
  }
  if (maker) {
    for (let g of maker) {
      if (shared.every((cp) => group_has_cp(g, cp))) {
        throw new Error(`whole-script confusable: ${group.N}/${g.N}`);
      }
    }
  }
}
function determine_group(unique) {
  let groups = GROUPS;
  for (let cp of unique) {
    let gs = groups.filter((g) => group_has_cp(g, cp));
    if (!gs.length) {
      if (!GROUPS.some((g) => group_has_cp(g, cp))) {
        throw error_disallowed(cp);
      } else {
        throw error_group_member(groups[0], cp);
      }
    }
    groups = gs;
    if (gs.length == 1)
      break;
  }
  return groups;
}
function flatten(split3) {
  return split3.map(({ input, error, output: output2 }) => {
    if (error) {
      let msg = error.message;
      throw new Error(split3.length == 1 ? msg : `Invalid label ${bidi_qq(safe_str_from_cps(input, 63))}: ${msg}`);
    }
    return str_from_cps(output2);
  }).join(STOP_CH);
}
function error_disallowed(cp) {
  return new Error(`disallowed character: ${quoted_cp(cp)}`);
}
function error_group_member(g, cp) {
  let quoted = quoted_cp(cp);
  let gg = GROUPS.find((g2) => g2.P.has(cp));
  if (gg) {
    quoted = `${gg.N} ${quoted}`;
  }
  return new Error(`illegal mixture: ${g.N} + ${quoted}`);
}
function error_placement(where) {
  return new Error(`illegal placement: ${where}`);
}
function check_group(g, cps) {
  for (let cp of cps) {
    if (!group_has_cp(g, cp)) {
      throw error_group_member(g, cp);
    }
  }
  if (g.M) {
    let decomposed2 = nfd(cps);
    for (let i = 1, e = decomposed2.length; i < e; i++) {
      if (NSM.has(decomposed2[i])) {
        let j = i + 1;
        for (let cp; j < e && NSM.has(cp = decomposed2[j]); j++) {
          for (let k = i; k < j; k++) {
            if (decomposed2[k] == cp) {
              throw new Error(`duplicate non-spacing marks: ${quoted_cp(cp)}`);
            }
          }
        }
        if (j - i > NSM_MAX) {
          throw new Error(`excessive non-spacing marks: ${bidi_qq(safe_str_from_cps(decomposed2.slice(i - 1, j)))} (${j - i}/${NSM_MAX})`);
        }
        i = j;
      }
    }
  }
}
function tokens_from_str(input, nf, ef) {
  let ret = [];
  let chars = [];
  input = input.slice().reverse();
  while (input.length) {
    let emoji = consume_emoji_reversed(input);
    if (emoji) {
      if (chars.length) {
        ret.push(nf(chars));
        chars = [];
      }
      ret.push(ef(emoji));
    } else {
      let cp = input.pop();
      if (VALID.has(cp)) {
        chars.push(cp);
      } else {
        let cps = MAPPED.get(cp);
        if (cps) {
          chars.push(...cps);
        } else if (!IGNORED.has(cp)) {
          throw error_disallowed(cp);
        }
      }
    }
  }
  if (chars.length) {
    ret.push(nf(chars));
  }
  return ret;
}
function filter_fe0f(cps) {
  return cps.filter((cp) => cp != FE0F);
}
function consume_emoji_reversed(cps, eaten) {
  let node = EMOJI_ROOT;
  let emoji;
  let pos = cps.length;
  while (pos) {
    node = node.get(cps[--pos]);
    if (!node)
      break;
    let { V } = node;
    if (V) {
      emoji = V;
      if (eaten)
        eaten.push(...cps.slice(pos).reverse());
      cps.length = pos;
    }
  }
  return emoji;
}

// node_modules/ethers/lib.esm/hash/namehash.js
var Zeros2 = new Uint8Array(32);
Zeros2.fill(0);
function checkComponent(comp) {
  assertArgument(comp.length !== 0, "invalid ENS name; empty component", "comp", comp);
  return comp;
}
function ensNameSplit(name) {
  const bytes2 = toUtf8Bytes(ensNormalize(name));
  const comps = [];
  if (name.length === 0) {
    return comps;
  }
  let last = 0;
  for (let i = 0; i < bytes2.length; i++) {
    const d = bytes2[i];
    if (d === 46) {
      comps.push(checkComponent(bytes2.slice(last, i)));
      last = i + 1;
    }
  }
  assertArgument(last < bytes2.length, "invalid ENS name; empty component", "name", name);
  comps.push(checkComponent(bytes2.slice(last)));
  return comps;
}
function ensNormalize(name) {
  try {
    if (name.length === 0) {
      throw new Error("empty label");
    }
    return ens_normalize(name);
  } catch (error) {
    assertArgument(false, `invalid ENS name (${error.message})`, "name", name);
  }
}
function isValidName(name) {
  try {
    return ensNameSplit(name).length !== 0;
  } catch (error) {
  }
  return false;
}
function namehash(name) {
  assertArgument(typeof name === "string", "invalid ENS name; not a string", "name", name);
  assertArgument(name.length, `invalid ENS name (empty label)`, "name", name);
  let result2 = Zeros2;
  const comps = ensNameSplit(name);
  while (comps.length) {
    result2 = keccak256(concat([result2, keccak256(comps.pop())]));
  }
  return hexlify(result2);
}
function dnsEncode(name, _maxLength) {
  const length = _maxLength != null ? _maxLength : 63;
  assertArgument(length <= 255, "DNS encoded label cannot exceed 255", "length", length);
  return hexlify(concat(ensNameSplit(name).map((comp) => {
    assertArgument(comp.length <= length, `label ${JSON.stringify(name)} exceeds ${length} bytes`, "name", name);
    const bytes2 = new Uint8Array(comp.length + 1);
    bytes2.set(comp, 1);
    bytes2[0] = bytes2.length - 1;
    return bytes2;
  }))) + "00";
}

// node_modules/ethers/lib.esm/hash/message.js
function hashMessage(message) {
  if (typeof message === "string") {
    message = toUtf8Bytes(message);
  }
  return keccak256(concat([
    toUtf8Bytes(MessagePrefix),
    toUtf8Bytes(String(message.length)),
    message
  ]));
}
function verifyMessage(message, sig) {
  const digest = hashMessage(message);
  return recoverAddress(digest, sig);
}

// node_modules/ethers/lib.esm/hash/typed-data.js
var padding = new Uint8Array(32);
padding.fill(0);
var BN__1 = BigInt(-1);
var BN_08 = BigInt(0);
var BN_15 = BigInt(1);
var BN_MAX_UINT2562 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
function hexPadRight(value) {
  const bytes2 = getBytes(value);
  const padOffset = bytes2.length % 32;
  if (padOffset) {
    return concat([bytes2, padding.slice(padOffset)]);
  }
  return hexlify(bytes2);
}
var hexTrue = toBeHex(BN_15, 32);
var hexFalse = toBeHex(BN_08, 32);
var domainFieldTypes = {
  name: "string",
  version: "string",
  chainId: "uint256",
  verifyingContract: "address",
  salt: "bytes32"
};
var domainFieldNames = [
  "name",
  "version",
  "chainId",
  "verifyingContract",
  "salt"
];
function checkString(key) {
  return function(value) {
    assertArgument(typeof value === "string", `invalid domain value for ${JSON.stringify(key)}`, `domain.${key}`, value);
    return value;
  };
}
var domainChecks = {
  name: checkString("name"),
  version: checkString("version"),
  chainId: function(_value) {
    const value = getBigInt(_value, "domain.chainId");
    assertArgument(value >= 0, "invalid chain ID", "domain.chainId", _value);
    if (Number.isSafeInteger(value)) {
      return Number(value);
    }
    return toQuantity(value);
  },
  verifyingContract: function(value) {
    try {
      return getAddress(value).toLowerCase();
    } catch (error) {
    }
    assertArgument(false, `invalid domain value "verifyingContract"`, "domain.verifyingContract", value);
  },
  salt: function(value) {
    const bytes2 = getBytes(value, "domain.salt");
    assertArgument(bytes2.length === 32, `invalid domain value "salt"`, "domain.salt", value);
    return hexlify(bytes2);
  }
};
function getBaseEncoder(type) {
  {
    const match = type.match(/^(u?)int(\d+)$/);
    if (match) {
      const signed2 = match[1] === "";
      const width = parseInt(match[2]);
      assertArgument(width % 8 === 0 && width !== 0 && width <= 256 && match[2] === String(width), "invalid numeric width", "type", type);
      const boundsUpper = mask(BN_MAX_UINT2562, signed2 ? width - 1 : width);
      const boundsLower = signed2 ? (boundsUpper + BN_15) * BN__1 : BN_08;
      return function(_value) {
        const value = getBigInt(_value, "value");
        assertArgument(value >= boundsLower && value <= boundsUpper, `value out-of-bounds for ${type}`, "value", value);
        return toBeHex(signed2 ? toTwos(value, 256) : value, 32);
      };
    }
  }
  {
    const match = type.match(/^bytes(\d+)$/);
    if (match) {
      const width = parseInt(match[1]);
      assertArgument(width !== 0 && width <= 32 && match[1] === String(width), "invalid bytes width", "type", type);
      return function(value) {
        const bytes2 = getBytes(value);
        assertArgument(bytes2.length === width, `invalid length for ${type}`, "value", value);
        return hexPadRight(value);
      };
    }
  }
  switch (type) {
    case "address":
      return function(value) {
        return zeroPadValue(getAddress(value), 32);
      };
    case "bool":
      return function(value) {
        return !value ? hexFalse : hexTrue;
      };
    case "bytes":
      return function(value) {
        return keccak256(value);
      };
    case "string":
      return function(value) {
        return id(value);
      };
  }
  return null;
}
function encodeType(name, fields) {
  return `${name}(${fields.map(({ name: name2, type }) => type + " " + name2).join(",")})`;
}
function splitArray(type) {
  const match = type.match(/^([^\x5b]*)((\x5b\d*\x5d)*)(\x5b(\d*)\x5d)$/);
  if (match) {
    return {
      base: match[1],
      index: match[2] + match[4],
      array: {
        base: match[1],
        prefix: match[1] + match[2],
        count: match[5] ? parseInt(match[5]) : -1
      }
    };
  }
  return { base: type };
}
var TypedDataEncoder = class _TypedDataEncoder {
  /**
   *  The primary type for the structured [[types]].
   *
   *  This is derived automatically from the [[types]], since no
   *  recursion is possible, once the DAG for the types is consturcted
   *  internally, the primary type must be the only remaining type with
   *  no parent nodes.
   */
  primaryType;
  #types;
  /**
   *  The types.
   */
  get types() {
    return JSON.parse(this.#types);
  }
  #fullTypes;
  #encoderCache;
  /**
   *  Create a new **TypedDataEncoder** for %%types%%.
   *
   *  This performs all necessary checking that types are valid and
   *  do not violate the [[link-eip-712]] structural constraints as
   *  well as computes the [[primaryType]].
   */
  constructor(_types) {
    this.#fullTypes = /* @__PURE__ */ new Map();
    this.#encoderCache = /* @__PURE__ */ new Map();
    const links = /* @__PURE__ */ new Map();
    const parents = /* @__PURE__ */ new Map();
    const subtypes = /* @__PURE__ */ new Map();
    const types = {};
    Object.keys(_types).forEach((type) => {
      types[type] = _types[type].map(({ name, type: type2 }) => {
        let { base, index } = splitArray(type2);
        if (base === "int" && !_types["int"]) {
          base = "int256";
        }
        if (base === "uint" && !_types["uint"]) {
          base = "uint256";
        }
        return { name, type: base + (index || "") };
      });
      links.set(type, /* @__PURE__ */ new Set());
      parents.set(type, []);
      subtypes.set(type, /* @__PURE__ */ new Set());
    });
    this.#types = JSON.stringify(types);
    for (const name in types) {
      const uniqueNames = /* @__PURE__ */ new Set();
      for (const field of types[name]) {
        assertArgument(!uniqueNames.has(field.name), `duplicate variable name ${JSON.stringify(field.name)} in ${JSON.stringify(name)}`, "types", _types);
        uniqueNames.add(field.name);
        const baseType = splitArray(field.type).base;
        assertArgument(baseType !== name, `circular type reference to ${JSON.stringify(baseType)}`, "types", _types);
        const encoder = getBaseEncoder(baseType);
        if (encoder) {
          continue;
        }
        assertArgument(parents.has(baseType), `unknown type ${JSON.stringify(baseType)}`, "types", _types);
        parents.get(baseType).push(name);
        links.get(name).add(baseType);
      }
    }
    const primaryTypes = Array.from(parents.keys()).filter((n2) => parents.get(n2).length === 0);
    assertArgument(primaryTypes.length !== 0, "missing primary type", "types", _types);
    assertArgument(primaryTypes.length === 1, `ambiguous primary types or unused types: ${primaryTypes.map((t) => JSON.stringify(t)).join(", ")}`, "types", _types);
    defineProperties(this, { primaryType: primaryTypes[0] });
    function checkCircular(type, found) {
      assertArgument(!found.has(type), `circular type reference to ${JSON.stringify(type)}`, "types", _types);
      found.add(type);
      for (const child of links.get(type)) {
        if (!parents.has(child)) {
          continue;
        }
        checkCircular(child, found);
        for (const subtype of found) {
          subtypes.get(subtype).add(child);
        }
      }
      found.delete(type);
    }
    checkCircular(this.primaryType, /* @__PURE__ */ new Set());
    for (const [name, set] of subtypes) {
      const st = Array.from(set);
      st.sort();
      this.#fullTypes.set(name, encodeType(name, types[name]) + st.map((t) => encodeType(t, types[t])).join(""));
    }
  }
  /**
   *  Returnthe encoder for the specific %%type%%.
   */
  getEncoder(type) {
    let encoder = this.#encoderCache.get(type);
    if (!encoder) {
      encoder = this.#getEncoder(type);
      this.#encoderCache.set(type, encoder);
    }
    return encoder;
  }
  #getEncoder(type) {
    {
      const encoder = getBaseEncoder(type);
      if (encoder) {
        return encoder;
      }
    }
    const array = splitArray(type).array;
    if (array) {
      const subtype = array.prefix;
      const subEncoder = this.getEncoder(subtype);
      return (value) => {
        assertArgument(array.count === -1 || array.count === value.length, `array length mismatch; expected length ${array.count}`, "value", value);
        let result2 = value.map(subEncoder);
        if (this.#fullTypes.has(subtype)) {
          result2 = result2.map(keccak256);
        }
        return keccak256(concat(result2));
      };
    }
    const fields = this.types[type];
    if (fields) {
      const encodedType = id(this.#fullTypes.get(type));
      return (value) => {
        const values = fields.map(({ name, type: type2 }) => {
          const result2 = this.getEncoder(type2)(value[name]);
          if (this.#fullTypes.has(type2)) {
            return keccak256(result2);
          }
          return result2;
        });
        values.unshift(encodedType);
        return concat(values);
      };
    }
    assertArgument(false, `unknown type: ${type}`, "type", type);
  }
  /**
   *  Return the full type for %%name%%.
   */
  encodeType(name) {
    const result2 = this.#fullTypes.get(name);
    assertArgument(result2, `unknown type: ${JSON.stringify(name)}`, "name", name);
    return result2;
  }
  /**
   *  Return the encoded %%value%% for the %%type%%.
   */
  encodeData(type, value) {
    return this.getEncoder(type)(value);
  }
  /**
   *  Returns the hash of %%value%% for the type of %%name%%.
   */
  hashStruct(name, value) {
    return keccak256(this.encodeData(name, value));
  }
  /**
   *  Return the fulled encoded %%value%% for the [[types]].
   */
  encode(value) {
    return this.encodeData(this.primaryType, value);
  }
  /**
   *  Return the hash of the fully encoded %%value%% for the [[types]].
   */
  hash(value) {
    return this.hashStruct(this.primaryType, value);
  }
  /**
   *  @_ignore:
   */
  _visit(type, value, callback) {
    {
      const encoder = getBaseEncoder(type);
      if (encoder) {
        return callback(type, value);
      }
    }
    const array = splitArray(type).array;
    if (array) {
      assertArgument(array.count === -1 || array.count === value.length, `array length mismatch; expected length ${array.count}`, "value", value);
      return value.map((v) => this._visit(array.prefix, v, callback));
    }
    const fields = this.types[type];
    if (fields) {
      return fields.reduce((accum, { name, type: type2 }) => {
        accum[name] = this._visit(type2, value[name], callback);
        return accum;
      }, {});
    }
    assertArgument(false, `unknown type: ${type}`, "type", type);
  }
  /**
   *  Call %%calback%% for each value in %%value%%, passing the type and
   *  component within %%value%%.
   *
   *  This is useful for replacing addresses or other transformation that
   *  may be desired on each component, based on its type.
   */
  visit(value, callback) {
    return this._visit(this.primaryType, value, callback);
  }
  /**
   *  Create a new **TypedDataEncoder** for %%types%%.
   */
  static from(types) {
    return new _TypedDataEncoder(types);
  }
  /**
   *  Return the primary type for %%types%%.
   */
  static getPrimaryType(types) {
    return _TypedDataEncoder.from(types).primaryType;
  }
  /**
   *  Return the hashed struct for %%value%% using %%types%% and %%name%%.
   */
  static hashStruct(name, types, value) {
    return _TypedDataEncoder.from(types).hashStruct(name, value);
  }
  /**
   *  Return the domain hash for %%domain%%.
   */
  static hashDomain(domain) {
    const domainFields = [];
    for (const name in domain) {
      if (domain[name] == null) {
        continue;
      }
      const type = domainFieldTypes[name];
      assertArgument(type, `invalid typed-data domain key: ${JSON.stringify(name)}`, "domain", domain);
      domainFields.push({ name, type });
    }
    domainFields.sort((a, b2) => {
      return domainFieldNames.indexOf(a.name) - domainFieldNames.indexOf(b2.name);
    });
    return _TypedDataEncoder.hashStruct("EIP712Domain", { EIP712Domain: domainFields }, domain);
  }
  /**
   *  Return the fully encoded [[link-eip-712]] %%value%% for %%types%% with %%domain%%.
   */
  static encode(domain, types, value) {
    return concat([
      "0x1901",
      _TypedDataEncoder.hashDomain(domain),
      _TypedDataEncoder.from(types).hash(value)
    ]);
  }
  /**
   *  Return the hash of the fully encoded [[link-eip-712]] %%value%% for %%types%% with %%domain%%.
   */
  static hash(domain, types, value) {
    return keccak256(_TypedDataEncoder.encode(domain, types, value));
  }
  // Replaces all address types with ENS names with their looked up address
  /**
   * Resolves to the value from resolving all addresses in %%value%% for
   * %%types%% and the %%domain%%.
   */
  static async resolveNames(domain, types, value, resolveName) {
    domain = Object.assign({}, domain);
    for (const key in domain) {
      if (domain[key] == null) {
        delete domain[key];
      }
    }
    const ensCache = {};
    if (domain.verifyingContract && !isHexString(domain.verifyingContract, 20)) {
      ensCache[domain.verifyingContract] = "0x";
    }
    const encoder = _TypedDataEncoder.from(types);
    encoder.visit(value, (type, value2) => {
      if (type === "address" && !isHexString(value2, 20)) {
        ensCache[value2] = "0x";
      }
      return value2;
    });
    for (const name in ensCache) {
      ensCache[name] = await resolveName(name);
    }
    if (domain.verifyingContract && ensCache[domain.verifyingContract]) {
      domain.verifyingContract = ensCache[domain.verifyingContract];
    }
    value = encoder.visit(value, (type, value2) => {
      if (type === "address" && ensCache[value2]) {
        return ensCache[value2];
      }
      return value2;
    });
    return { domain, value };
  }
  /**
   *  Returns the JSON-encoded payload expected by nodes which implement
   *  the JSON-RPC [[link-eip-712]] method.
   */
  static getPayload(domain, types, value) {
    _TypedDataEncoder.hashDomain(domain);
    const domainValues = {};
    const domainTypes = [];
    domainFieldNames.forEach((name) => {
      const value2 = domain[name];
      if (value2 == null) {
        return;
      }
      domainValues[name] = domainChecks[name](value2);
      domainTypes.push({ name, type: domainFieldTypes[name] });
    });
    const encoder = _TypedDataEncoder.from(types);
    types = encoder.types;
    const typesWithDomain = Object.assign({}, types);
    assertArgument(typesWithDomain.EIP712Domain == null, "types must not contain EIP712Domain type", "types.EIP712Domain", types);
    typesWithDomain.EIP712Domain = domainTypes;
    encoder.encode(value);
    return {
      types: typesWithDomain,
      domain: domainValues,
      primaryType: encoder.primaryType,
      message: encoder.visit(value, (type, value2) => {
        if (type.match(/^bytes(\d*)/)) {
          return hexlify(getBytes(value2));
        }
        if (type.match(/^u?int/)) {
          return getBigInt(value2).toString();
        }
        switch (type) {
          case "address":
            return value2.toLowerCase();
          case "bool":
            return !!value2;
          case "string":
            assertArgument(typeof value2 === "string", "invalid string", "value", value2);
            return value2;
        }
        assertArgument(false, "unsupported type", "type", type);
      })
    };
  }
};

// node_modules/ethers/lib.esm/abi/fragments.js
function setify(items) {
  const result2 = /* @__PURE__ */ new Set();
  items.forEach((k) => result2.add(k));
  return Object.freeze(result2);
}
var _kwVisibDeploy = "external public payable override";
var KwVisibDeploy = setify(_kwVisibDeploy.split(" "));
var _kwVisib = "constant external internal payable private public pure view override";
var KwVisib = setify(_kwVisib.split(" "));
var _kwTypes = "constructor error event fallback function receive struct";
var KwTypes = setify(_kwTypes.split(" "));
var _kwModifiers = "calldata memory storage payable indexed";
var KwModifiers = setify(_kwModifiers.split(" "));
var _kwOther = "tuple returns";
var _keywords = [_kwTypes, _kwModifiers, _kwOther, _kwVisib].join(" ");
var Keywords = setify(_keywords.split(" "));
var SimpleTokens = {
  "(": "OPEN_PAREN",
  ")": "CLOSE_PAREN",
  "[": "OPEN_BRACKET",
  "]": "CLOSE_BRACKET",
  ",": "COMMA",
  "@": "AT"
};
var regexWhitespacePrefix = new RegExp("^(\\s*)");
var regexNumberPrefix = new RegExp("^([0-9]+)");
var regexIdPrefix = new RegExp("^([a-zA-Z$_][a-zA-Z0-9$_]*)");
var regexId = new RegExp("^([a-zA-Z$_][a-zA-Z0-9$_]*)$");
var regexType = new RegExp("^(address|bool|bytes([0-9]*)|string|u?int([0-9]*))$");
var TokenString = class _TokenString {
  #offset;
  #tokens;
  get offset() {
    return this.#offset;
  }
  get length() {
    return this.#tokens.length - this.#offset;
  }
  constructor(tokens) {
    this.#offset = 0;
    this.#tokens = tokens.slice();
  }
  clone() {
    return new _TokenString(this.#tokens);
  }
  reset() {
    this.#offset = 0;
  }
  #subTokenString(from = 0, to = 0) {
    return new _TokenString(this.#tokens.slice(from, to).map((t) => {
      return Object.freeze(Object.assign({}, t, {
        match: t.match - from,
        linkBack: t.linkBack - from,
        linkNext: t.linkNext - from
      }));
    }));
  }
  // Pops and returns the value of the next token, if it is a keyword in allowed; throws if out of tokens
  popKeyword(allowed) {
    const top = this.peek();
    if (top.type !== "KEYWORD" || !allowed.has(top.text)) {
      throw new Error(`expected keyword ${top.text}`);
    }
    return this.pop().text;
  }
  // Pops and returns the value of the next token if it is `type`; throws if out of tokens
  popType(type) {
    if (this.peek().type !== type) {
      const top = this.peek();
      throw new Error(`expected ${type}; got ${top.type} ${JSON.stringify(top.text)}`);
    }
    return this.pop().text;
  }
  // Pops and returns a "(" TOKENS ")"
  popParen() {
    const top = this.peek();
    if (top.type !== "OPEN_PAREN") {
      throw new Error("bad start");
    }
    const result2 = this.#subTokenString(this.#offset + 1, top.match + 1);
    this.#offset = top.match + 1;
    return result2;
  }
  // Pops and returns the items within "(" ITEM1 "," ITEM2 "," ... ")"
  popParams() {
    const top = this.peek();
    if (top.type !== "OPEN_PAREN") {
      throw new Error("bad start");
    }
    const result2 = [];
    while (this.#offset < top.match - 1) {
      const link = this.peek().linkNext;
      result2.push(this.#subTokenString(this.#offset + 1, link));
      this.#offset = link;
    }
    this.#offset = top.match + 1;
    return result2;
  }
  // Returns the top Token, throwing if out of tokens
  peek() {
    if (this.#offset >= this.#tokens.length) {
      throw new Error("out-of-bounds");
    }
    return this.#tokens[this.#offset];
  }
  // Returns the next value, if it is a keyword in `allowed`
  peekKeyword(allowed) {
    const top = this.peekType("KEYWORD");
    return top != null && allowed.has(top) ? top : null;
  }
  // Returns the value of the next token if it is `type`
  peekType(type) {
    if (this.length === 0) {
      return null;
    }
    const top = this.peek();
    return top.type === type ? top.text : null;
  }
  // Returns the next token; throws if out of tokens
  pop() {
    const result2 = this.peek();
    this.#offset++;
    return result2;
  }
  toString() {
    const tokens = [];
    for (let i = this.#offset; i < this.#tokens.length; i++) {
      const token = this.#tokens[i];
      tokens.push(`${token.type}:${token.text}`);
    }
    return `<TokenString ${tokens.join(" ")}>`;
  }
};
function lex(text) {
  const tokens = [];
  const throwError2 = (message) => {
    const token = offset < text.length ? JSON.stringify(text[offset]) : "$EOI";
    throw new Error(`invalid token ${token} at ${offset}: ${message}`);
  };
  let brackets = [];
  let commas = [];
  let offset = 0;
  while (offset < text.length) {
    let cur = text.substring(offset);
    let match = cur.match(regexWhitespacePrefix);
    if (match) {
      offset += match[1].length;
      cur = text.substring(offset);
    }
    const token = { depth: brackets.length, linkBack: -1, linkNext: -1, match: -1, type: "", text: "", offset, value: -1 };
    tokens.push(token);
    let type = SimpleTokens[cur[0]] || "";
    if (type) {
      token.type = type;
      token.text = cur[0];
      offset++;
      if (type === "OPEN_PAREN") {
        brackets.push(tokens.length - 1);
        commas.push(tokens.length - 1);
      } else if (type == "CLOSE_PAREN") {
        if (brackets.length === 0) {
          throwError2("no matching open bracket");
        }
        token.match = brackets.pop();
        tokens[token.match].match = tokens.length - 1;
        token.depth--;
        token.linkBack = commas.pop();
        tokens[token.linkBack].linkNext = tokens.length - 1;
      } else if (type === "COMMA") {
        token.linkBack = commas.pop();
        tokens[token.linkBack].linkNext = tokens.length - 1;
        commas.push(tokens.length - 1);
      } else if (type === "OPEN_BRACKET") {
        token.type = "BRACKET";
      } else if (type === "CLOSE_BRACKET") {
        let suffix = tokens.pop().text;
        if (tokens.length > 0 && tokens[tokens.length - 1].type === "NUMBER") {
          const value = tokens.pop().text;
          suffix = value + suffix;
          tokens[tokens.length - 1].value = getNumber(value);
        }
        if (tokens.length === 0 || tokens[tokens.length - 1].type !== "BRACKET") {
          throw new Error("missing opening bracket");
        }
        tokens[tokens.length - 1].text += suffix;
      }
      continue;
    }
    match = cur.match(regexIdPrefix);
    if (match) {
      token.text = match[1];
      offset += token.text.length;
      if (Keywords.has(token.text)) {
        token.type = "KEYWORD";
        continue;
      }
      if (token.text.match(regexType)) {
        token.type = "TYPE";
        continue;
      }
      token.type = "ID";
      continue;
    }
    match = cur.match(regexNumberPrefix);
    if (match) {
      token.text = match[1];
      token.type = "NUMBER";
      offset += token.text.length;
      continue;
    }
    throw new Error(`unexpected token ${JSON.stringify(cur[0])} at position ${offset}`);
  }
  return new TokenString(tokens.map((t) => Object.freeze(t)));
}
function allowSingle(set, allowed) {
  let included = [];
  for (const key in allowed.keys()) {
    if (set.has(key)) {
      included.push(key);
    }
  }
  if (included.length > 1) {
    throw new Error(`conflicting types: ${included.join(", ")}`);
  }
}
function consumeName(type, tokens) {
  if (tokens.peekKeyword(KwTypes)) {
    const keyword = tokens.pop().text;
    if (keyword !== type) {
      throw new Error(`expected ${type}, got ${keyword}`);
    }
  }
  return tokens.popType("ID");
}
function consumeKeywords(tokens, allowed) {
  const keywords = /* @__PURE__ */ new Set();
  while (true) {
    const keyword = tokens.peekType("KEYWORD");
    if (keyword == null || allowed && !allowed.has(keyword)) {
      break;
    }
    tokens.pop();
    if (keywords.has(keyword)) {
      throw new Error(`duplicate keywords: ${JSON.stringify(keyword)}`);
    }
    keywords.add(keyword);
  }
  return Object.freeze(keywords);
}
function consumeMutability(tokens) {
  let modifiers = consumeKeywords(tokens, KwVisib);
  allowSingle(modifiers, setify("constant payable nonpayable".split(" ")));
  allowSingle(modifiers, setify("pure view payable nonpayable".split(" ")));
  if (modifiers.has("view")) {
    return "view";
  }
  if (modifiers.has("pure")) {
    return "pure";
  }
  if (modifiers.has("payable")) {
    return "payable";
  }
  if (modifiers.has("nonpayable")) {
    return "nonpayable";
  }
  if (modifiers.has("constant")) {
    return "view";
  }
  return "nonpayable";
}
function consumeParams(tokens, allowIndexed) {
  return tokens.popParams().map((t) => ParamType.from(t, allowIndexed));
}
function consumeGas(tokens) {
  if (tokens.peekType("AT")) {
    tokens.pop();
    if (tokens.peekType("NUMBER")) {
      return getBigInt(tokens.pop().text);
    }
    throw new Error("invalid gas");
  }
  return null;
}
function consumeEoi(tokens) {
  if (tokens.length) {
    throw new Error(`unexpected tokens at offset ${tokens.offset}: ${tokens.toString()}`);
  }
}
var regexArrayType = new RegExp(/^(.*)\[([0-9]*)\]$/);
function verifyBasicType(type) {
  const match = type.match(regexType);
  assertArgument(match, "invalid type", "type", type);
  if (type === "uint") {
    return "uint256";
  }
  if (type === "int") {
    return "int256";
  }
  if (match[2]) {
    const length = parseInt(match[2]);
    assertArgument(length !== 0 && length <= 32, "invalid bytes length", "type", type);
  } else if (match[3]) {
    const size = parseInt(match[3]);
    assertArgument(size !== 0 && size <= 256 && size % 8 === 0, "invalid numeric width", "type", type);
  }
  return type;
}
var _guard4 = {};
var internal = Symbol.for("_ethers_internal");
var ParamTypeInternal = "_ParamTypeInternal";
var ErrorFragmentInternal = "_ErrorInternal";
var EventFragmentInternal = "_EventInternal";
var ConstructorFragmentInternal = "_ConstructorInternal";
var FallbackFragmentInternal = "_FallbackInternal";
var FunctionFragmentInternal = "_FunctionInternal";
var StructFragmentInternal = "_StructInternal";
var ParamType = class _ParamType {
  /**
   *  The local name of the parameter (or ``""`` if unbound)
   */
  name;
  /**
   *  The fully qualified type (e.g. ``"address"``, ``"tuple(address)"``,
   *  ``"uint256[3][]"``)
   */
  type;
  /**
   *  The base type (e.g. ``"address"``, ``"tuple"``, ``"array"``)
   */
  baseType;
  /**
   *  True if the parameters is indexed.
   *
   *  For non-indexable types this is ``null``.
   */
  indexed;
  /**
   *  The components for the tuple.
   *
   *  For non-tuple types this is ``null``.
   */
  components;
  /**
   *  The array length, or ``-1`` for dynamic-lengthed arrays.
   *
   *  For non-array types this is ``null``.
   */
  arrayLength;
  /**
   *  The type of each child in the array.
   *
   *  For non-array types this is ``null``.
   */
  arrayChildren;
  /**
   *  @private
   */
  constructor(guard, name, type, baseType, indexed, components, arrayLength, arrayChildren) {
    assertPrivate(guard, _guard4, "ParamType");
    Object.defineProperty(this, internal, { value: ParamTypeInternal });
    if (components) {
      components = Object.freeze(components.slice());
    }
    if (baseType === "array") {
      if (arrayLength == null || arrayChildren == null) {
        throw new Error("");
      }
    } else if (arrayLength != null || arrayChildren != null) {
      throw new Error("");
    }
    if (baseType === "tuple") {
      if (components == null) {
        throw new Error("");
      }
    } else if (components != null) {
      throw new Error("");
    }
    defineProperties(this, {
      name,
      type,
      baseType,
      indexed,
      components,
      arrayLength,
      arrayChildren
    });
  }
  /**
   *  Return a string representation of this type.
   *
   *  For example,
   *
   *  ``sighash" => "(uint256,address)"``
   *
   *  ``"minimal" => "tuple(uint256,address) indexed"``
   *
   *  ``"full" => "tuple(uint256 foo, address bar) indexed baz"``
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      const name = this.name || "";
      if (this.isArray()) {
        const result4 = JSON.parse(this.arrayChildren.format("json"));
        result4.name = name;
        result4.type += `[${this.arrayLength < 0 ? "" : String(this.arrayLength)}]`;
        return JSON.stringify(result4);
      }
      const result3 = {
        type: this.baseType === "tuple" ? "tuple" : this.type,
        name
      };
      if (typeof this.indexed === "boolean") {
        result3.indexed = this.indexed;
      }
      if (this.isTuple()) {
        result3.components = this.components.map((c) => JSON.parse(c.format(format)));
      }
      return JSON.stringify(result3);
    }
    let result2 = "";
    if (this.isArray()) {
      result2 += this.arrayChildren.format(format);
      result2 += `[${this.arrayLength < 0 ? "" : String(this.arrayLength)}]`;
    } else {
      if (this.isTuple()) {
        result2 += "(" + this.components.map((comp) => comp.format(format)).join(format === "full" ? ", " : ",") + ")";
      } else {
        result2 += this.type;
      }
    }
    if (format !== "sighash") {
      if (this.indexed === true) {
        result2 += " indexed";
      }
      if (format === "full" && this.name) {
        result2 += " " + this.name;
      }
    }
    return result2;
  }
  /**
   *  Returns true if %%this%% is an Array type.
   *
   *  This provides a type gaurd ensuring that [[arrayChildren]]
   *  and [[arrayLength]] are non-null.
   */
  isArray() {
    return this.baseType === "array";
  }
  /**
   *  Returns true if %%this%% is a Tuple type.
   *
   *  This provides a type gaurd ensuring that [[components]]
   *  is non-null.
   */
  isTuple() {
    return this.baseType === "tuple";
  }
  /**
   *  Returns true if %%this%% is an Indexable type.
   *
   *  This provides a type gaurd ensuring that [[indexed]]
   *  is non-null.
   */
  isIndexable() {
    return this.indexed != null;
  }
  /**
   *  Walks the **ParamType** with %%value%%, calling %%process%%
   *  on each type, destructing the %%value%% recursively.
   */
  walk(value, process2) {
    if (this.isArray()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid array value");
      }
      if (this.arrayLength !== -1 && value.length !== this.arrayLength) {
        throw new Error("array is wrong length");
      }
      const _this = this;
      return value.map((v) => _this.arrayChildren.walk(v, process2));
    }
    if (this.isTuple()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid tuple value");
      }
      if (value.length !== this.components.length) {
        throw new Error("array is wrong length");
      }
      const _this = this;
      return value.map((v, i) => _this.components[i].walk(v, process2));
    }
    return process2(this.type, value);
  }
  #walkAsync(promises, value, process2, setValue) {
    if (this.isArray()) {
      if (!Array.isArray(value)) {
        throw new Error("invalid array value");
      }
      if (this.arrayLength !== -1 && value.length !== this.arrayLength) {
        throw new Error("array is wrong length");
      }
      const childType = this.arrayChildren;
      const result3 = value.slice();
      result3.forEach((value2, index) => {
        childType.#walkAsync(promises, value2, process2, (value3) => {
          result3[index] = value3;
        });
      });
      setValue(result3);
      return;
    }
    if (this.isTuple()) {
      const components = this.components;
      let result3;
      if (Array.isArray(value)) {
        result3 = value.slice();
      } else {
        if (value == null || typeof value !== "object") {
          throw new Error("invalid tuple value");
        }
        result3 = components.map((param) => {
          if (!param.name) {
            throw new Error("cannot use object value with unnamed components");
          }
          if (!(param.name in value)) {
            throw new Error(`missing value for component ${param.name}`);
          }
          return value[param.name];
        });
      }
      if (result3.length !== this.components.length) {
        throw new Error("array is wrong length");
      }
      result3.forEach((value2, index) => {
        components[index].#walkAsync(promises, value2, process2, (value3) => {
          result3[index] = value3;
        });
      });
      setValue(result3);
      return;
    }
    const result2 = process2(this.type, value);
    if (result2.then) {
      promises.push(async function() {
        setValue(await result2);
      }());
    } else {
      setValue(result2);
    }
  }
  /**
   *  Walks the **ParamType** with %%value%%, asynchronously calling
   *  %%process%% on each type, destructing the %%value%% recursively.
   *
   *  This can be used to resolve ENS names by walking and resolving each
   *  ``"address"`` type.
   */
  async walkAsync(value, process2) {
    const promises = [];
    const result2 = [value];
    this.#walkAsync(promises, value, process2, (value2) => {
      result2[0] = value2;
    });
    if (promises.length) {
      await Promise.all(promises);
    }
    return result2[0];
  }
  /**
   *  Creates a new **ParamType** for %%obj%%.
   *
   *  If %%allowIndexed%% then the ``indexed`` keyword is permitted,
   *  otherwise the ``indexed`` keyword will throw an error.
   */
  static from(obj, allowIndexed) {
    if (_ParamType.isParamType(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return _ParamType.from(lex(obj), allowIndexed);
      } catch (error) {
        assertArgument(false, "invalid param type", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      let type2 = "", baseType = "";
      let comps = null;
      if (consumeKeywords(obj, setify(["tuple"])).has("tuple") || obj.peekType("OPEN_PAREN")) {
        baseType = "tuple";
        comps = obj.popParams().map((t) => _ParamType.from(t));
        type2 = `tuple(${comps.map((c) => c.format()).join(",")})`;
      } else {
        type2 = verifyBasicType(obj.popType("TYPE"));
        baseType = type2;
      }
      let arrayChildren = null;
      let arrayLength = null;
      while (obj.length && obj.peekType("BRACKET")) {
        const bracket = obj.pop();
        arrayChildren = new _ParamType(_guard4, "", type2, baseType, null, comps, arrayLength, arrayChildren);
        arrayLength = bracket.value;
        type2 += bracket.text;
        baseType = "array";
        comps = null;
      }
      let indexed2 = null;
      const keywords = consumeKeywords(obj, KwModifiers);
      if (keywords.has("indexed")) {
        if (!allowIndexed) {
          throw new Error("");
        }
        indexed2 = true;
      }
      const name2 = obj.peekType("ID") ? obj.pop().text : "";
      if (obj.length) {
        throw new Error("leftover tokens");
      }
      return new _ParamType(_guard4, name2, type2, baseType, indexed2, comps, arrayLength, arrayChildren);
    }
    const name = obj.name;
    assertArgument(!name || typeof name === "string" && name.match(regexId), "invalid name", "obj.name", name);
    let indexed = obj.indexed;
    if (indexed != null) {
      assertArgument(allowIndexed, "parameter cannot be indexed", "obj.indexed", obj.indexed);
      indexed = !!indexed;
    }
    let type = obj.type;
    let arrayMatch = type.match(regexArrayType);
    if (arrayMatch) {
      const arrayLength = parseInt(arrayMatch[2] || "-1");
      const arrayChildren = _ParamType.from({
        type: arrayMatch[1],
        components: obj.components
      });
      return new _ParamType(_guard4, name || "", type, "array", indexed, null, arrayLength, arrayChildren);
    }
    if (type === "tuple" || type.startsWith(
      "tuple("
      /* fix: ) */
    ) || type.startsWith(
      "("
      /* fix: ) */
    )) {
      const comps = obj.components != null ? obj.components.map((c) => _ParamType.from(c)) : null;
      const tuple = new _ParamType(_guard4, name || "", type, "tuple", indexed, comps, null, null);
      return tuple;
    }
    type = verifyBasicType(obj.type);
    return new _ParamType(_guard4, name || "", type, type, indexed, null, null, null);
  }
  /**
   *  Returns true if %%value%% is a **ParamType**.
   */
  static isParamType(value) {
    return value && value[internal] === ParamTypeInternal;
  }
};
var Fragment = class _Fragment {
  /**
   *  The type of the fragment.
   */
  type;
  /**
   *  The inputs for the fragment.
   */
  inputs;
  /**
   *  @private
   */
  constructor(guard, type, inputs) {
    assertPrivate(guard, _guard4, "Fragment");
    inputs = Object.freeze(inputs.slice());
    defineProperties(this, { type, inputs });
  }
  /**
   *  Creates a new **Fragment** for %%obj%%, wich can be any supported
   *  ABI frgament type.
   */
  static from(obj) {
    if (typeof obj === "string") {
      try {
        _Fragment.from(JSON.parse(obj));
      } catch (e) {
      }
      return _Fragment.from(lex(obj));
    }
    if (obj instanceof TokenString) {
      const type = obj.peekKeyword(KwTypes);
      switch (type) {
        case "constructor":
          return ConstructorFragment.from(obj);
        case "error":
          return ErrorFragment.from(obj);
        case "event":
          return EventFragment.from(obj);
        case "fallback":
        case "receive":
          return FallbackFragment.from(obj);
        case "function":
          return FunctionFragment.from(obj);
        case "struct":
          return StructFragment.from(obj);
      }
    } else if (typeof obj === "object") {
      switch (obj.type) {
        case "constructor":
          return ConstructorFragment.from(obj);
        case "error":
          return ErrorFragment.from(obj);
        case "event":
          return EventFragment.from(obj);
        case "fallback":
        case "receive":
          return FallbackFragment.from(obj);
        case "function":
          return FunctionFragment.from(obj);
        case "struct":
          return StructFragment.from(obj);
      }
      assert(false, `unsupported type: ${obj.type}`, "UNSUPPORTED_OPERATION", {
        operation: "Fragment.from"
      });
    }
    assertArgument(false, "unsupported frgament object", "obj", obj);
  }
  /**
   *  Returns true if %%value%% is a [[ConstructorFragment]].
   */
  static isConstructor(value) {
    return ConstructorFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is an [[ErrorFragment]].
   */
  static isError(value) {
    return ErrorFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is an [[EventFragment]].
   */
  static isEvent(value) {
    return EventFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is a [[FunctionFragment]].
   */
  static isFunction(value) {
    return FunctionFragment.isFragment(value);
  }
  /**
   *  Returns true if %%value%% is a [[StructFragment]].
   */
  static isStruct(value) {
    return StructFragment.isFragment(value);
  }
};
var NamedFragment = class extends Fragment {
  /**
   *  The name of the fragment.
   */
  name;
  /**
   *  @private
   */
  constructor(guard, type, name, inputs) {
    super(guard, type, inputs);
    assertArgument(typeof name === "string" && name.match(regexId), "invalid identifier", "name", name);
    inputs = Object.freeze(inputs.slice());
    defineProperties(this, { name });
  }
};
function joinParams(format, params) {
  return "(" + params.map((p) => p.format(format)).join(format === "full" ? ", " : ",") + ")";
}
var ErrorFragment = class _ErrorFragment extends NamedFragment {
  /**
   *  @private
   */
  constructor(guard, name, inputs) {
    super(guard, "error", name, inputs);
    Object.defineProperty(this, internal, { value: ErrorFragmentInternal });
  }
  /**
   *  The Custom Error selector.
   */
  get selector() {
    return id(this.format("sighash")).substring(0, 10);
  }
  /**
   *  Returns a string representation of this fragment as %%format%%.
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      return JSON.stringify({
        type: "error",
        name: this.name,
        inputs: this.inputs.map((input) => JSON.parse(input.format(format)))
      });
    }
    const result2 = [];
    if (format !== "sighash") {
      result2.push("error");
    }
    result2.push(this.name + joinParams(format, this.inputs));
    return result2.join(" ");
  }
  /**
   *  Returns a new **ErrorFragment** for %%obj%%.
   */
  static from(obj) {
    if (_ErrorFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      return _ErrorFragment.from(lex(obj));
    } else if (obj instanceof TokenString) {
      const name = consumeName("error", obj);
      const inputs = consumeParams(obj);
      consumeEoi(obj);
      return new _ErrorFragment(_guard4, name, inputs);
    }
    return new _ErrorFragment(_guard4, obj.name, obj.inputs ? obj.inputs.map(ParamType.from) : []);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is an
   *  **ErrorFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === ErrorFragmentInternal;
  }
};
var EventFragment = class _EventFragment extends NamedFragment {
  /**
   *  Whether this event is anonymous.
   */
  anonymous;
  /**
   *  @private
   */
  constructor(guard, name, inputs, anonymous) {
    super(guard, "event", name, inputs);
    Object.defineProperty(this, internal, { value: EventFragmentInternal });
    defineProperties(this, { anonymous });
  }
  /**
   *  The Event topic hash.
   */
  get topicHash() {
    return id(this.format("sighash"));
  }
  /**
   *  Returns a string representation of this event as %%format%%.
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      return JSON.stringify({
        type: "event",
        anonymous: this.anonymous,
        name: this.name,
        inputs: this.inputs.map((i) => JSON.parse(i.format(format)))
      });
    }
    const result2 = [];
    if (format !== "sighash") {
      result2.push("event");
    }
    result2.push(this.name + joinParams(format, this.inputs));
    if (format !== "sighash" && this.anonymous) {
      result2.push("anonymous");
    }
    return result2.join(" ");
  }
  /**
   *  Return the topic hash for an event with %%name%% and %%params%%.
   */
  static getTopicHash(name, params) {
    params = (params || []).map((p) => ParamType.from(p));
    const fragment = new _EventFragment(_guard4, name, params, false);
    return fragment.topicHash;
  }
  /**
   *  Returns a new **EventFragment** for %%obj%%.
   */
  static from(obj) {
    if (_EventFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return _EventFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid event fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const name = consumeName("event", obj);
      const inputs = consumeParams(obj, true);
      const anonymous = !!consumeKeywords(obj, setify(["anonymous"])).has("anonymous");
      consumeEoi(obj);
      return new _EventFragment(_guard4, name, inputs, anonymous);
    }
    return new _EventFragment(_guard4, obj.name, obj.inputs ? obj.inputs.map((p) => ParamType.from(p, true)) : [], !!obj.anonymous);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is an
   *  **EventFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === EventFragmentInternal;
  }
};
var ConstructorFragment = class _ConstructorFragment extends Fragment {
  /**
   *  Whether the constructor can receive an endowment.
   */
  payable;
  /**
   *  The recommended gas limit for deployment or ``null``.
   */
  gas;
  /**
   *  @private
   */
  constructor(guard, type, inputs, payable, gas) {
    super(guard, type, inputs);
    Object.defineProperty(this, internal, { value: ConstructorFragmentInternal });
    defineProperties(this, { payable, gas });
  }
  /**
   *  Returns a string representation of this constructor as %%format%%.
   */
  format(format) {
    assert(format != null && format !== "sighash", "cannot format a constructor for sighash", "UNSUPPORTED_OPERATION", { operation: "format(sighash)" });
    if (format === "json") {
      return JSON.stringify({
        type: "constructor",
        stateMutability: this.payable ? "payable" : "undefined",
        payable: this.payable,
        gas: this.gas != null ? this.gas : void 0,
        inputs: this.inputs.map((i) => JSON.parse(i.format(format)))
      });
    }
    const result2 = [`constructor${joinParams(format, this.inputs)}`];
    if (this.payable) {
      result2.push("payable");
    }
    if (this.gas != null) {
      result2.push(`@${this.gas.toString()}`);
    }
    return result2.join(" ");
  }
  /**
   *  Returns a new **ConstructorFragment** for %%obj%%.
   */
  static from(obj) {
    if (_ConstructorFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return _ConstructorFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid constuctor fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      consumeKeywords(obj, setify(["constructor"]));
      const inputs = consumeParams(obj);
      const payable = !!consumeKeywords(obj, KwVisibDeploy).has("payable");
      const gas = consumeGas(obj);
      consumeEoi(obj);
      return new _ConstructorFragment(_guard4, "constructor", inputs, payable, gas);
    }
    return new _ConstructorFragment(_guard4, "constructor", obj.inputs ? obj.inputs.map(ParamType.from) : [], !!obj.payable, obj.gas != null ? obj.gas : null);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **ConstructorFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === ConstructorFragmentInternal;
  }
};
var FallbackFragment = class _FallbackFragment extends Fragment {
  /**
   *  If the function can be sent value during invocation.
   */
  payable;
  constructor(guard, inputs, payable) {
    super(guard, "fallback", inputs);
    Object.defineProperty(this, internal, { value: FallbackFragmentInternal });
    defineProperties(this, { payable });
  }
  /**
   *  Returns a string representation of this fallback as %%format%%.
   */
  format(format) {
    const type = this.inputs.length === 0 ? "receive" : "fallback";
    if (format === "json") {
      const stateMutability = this.payable ? "payable" : "nonpayable";
      return JSON.stringify({ type, stateMutability });
    }
    return `${type}()${this.payable ? " payable" : ""}`;
  }
  /**
   *  Returns a new **FallbackFragment** for %%obj%%.
   */
  static from(obj) {
    if (_FallbackFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return _FallbackFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid fallback fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const errorObj = obj.toString();
      const topIsValid = obj.peekKeyword(setify(["fallback", "receive"]));
      assertArgument(topIsValid, "type must be fallback or receive", "obj", errorObj);
      const type = obj.popKeyword(setify(["fallback", "receive"]));
      if (type === "receive") {
        const inputs2 = consumeParams(obj);
        assertArgument(inputs2.length === 0, `receive cannot have arguments`, "obj.inputs", inputs2);
        consumeKeywords(obj, setify(["payable"]));
        consumeEoi(obj);
        return new _FallbackFragment(_guard4, [], true);
      }
      let inputs = consumeParams(obj);
      if (inputs.length) {
        assertArgument(inputs.length === 1 && inputs[0].type === "bytes", "invalid fallback inputs", "obj.inputs", inputs.map((i) => i.format("minimal")).join(", "));
      } else {
        inputs = [ParamType.from("bytes")];
      }
      const mutability = consumeMutability(obj);
      assertArgument(mutability === "nonpayable" || mutability === "payable", "fallback cannot be constants", "obj.stateMutability", mutability);
      if (consumeKeywords(obj, setify(["returns"])).has("returns")) {
        const outputs = consumeParams(obj);
        assertArgument(outputs.length === 1 && outputs[0].type === "bytes", "invalid fallback outputs", "obj.outputs", outputs.map((i) => i.format("minimal")).join(", "));
      }
      consumeEoi(obj);
      return new _FallbackFragment(_guard4, inputs, mutability === "payable");
    }
    if (obj.type === "receive") {
      return new _FallbackFragment(_guard4, [], true);
    }
    if (obj.type === "fallback") {
      const inputs = [ParamType.from("bytes")];
      const payable = obj.stateMutability === "payable";
      return new _FallbackFragment(_guard4, inputs, payable);
    }
    assertArgument(false, "invalid fallback description", "obj", obj);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **FallbackFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === FallbackFragmentInternal;
  }
};
var FunctionFragment = class _FunctionFragment extends NamedFragment {
  /**
   *  If the function is constant (e.g. ``pure`` or ``view`` functions).
   */
  constant;
  /**
   *  The returned types for the result of calling this function.
   */
  outputs;
  /**
   *  The state mutability (e.g. ``payable``, ``nonpayable``, ``view``
   *  or ``pure``)
   */
  stateMutability;
  /**
   *  If the function can be sent value during invocation.
   */
  payable;
  /**
   *  The recommended gas limit to send when calling this function.
   */
  gas;
  /**
   *  @private
   */
  constructor(guard, name, stateMutability, inputs, outputs, gas) {
    super(guard, "function", name, inputs);
    Object.defineProperty(this, internal, { value: FunctionFragmentInternal });
    outputs = Object.freeze(outputs.slice());
    const constant = stateMutability === "view" || stateMutability === "pure";
    const payable = stateMutability === "payable";
    defineProperties(this, { constant, gas, outputs, payable, stateMutability });
  }
  /**
   *  The Function selector.
   */
  get selector() {
    return id(this.format("sighash")).substring(0, 10);
  }
  /**
   *  Returns a string representation of this function as %%format%%.
   */
  format(format) {
    if (format == null) {
      format = "sighash";
    }
    if (format === "json") {
      return JSON.stringify({
        type: "function",
        name: this.name,
        constant: this.constant,
        stateMutability: this.stateMutability !== "nonpayable" ? this.stateMutability : void 0,
        payable: this.payable,
        gas: this.gas != null ? this.gas : void 0,
        inputs: this.inputs.map((i) => JSON.parse(i.format(format))),
        outputs: this.outputs.map((o) => JSON.parse(o.format(format)))
      });
    }
    const result2 = [];
    if (format !== "sighash") {
      result2.push("function");
    }
    result2.push(this.name + joinParams(format, this.inputs));
    if (format !== "sighash") {
      if (this.stateMutability !== "nonpayable") {
        result2.push(this.stateMutability);
      }
      if (this.outputs && this.outputs.length) {
        result2.push("returns");
        result2.push(joinParams(format, this.outputs));
      }
      if (this.gas != null) {
        result2.push(`@${this.gas.toString()}`);
      }
    }
    return result2.join(" ");
  }
  /**
   *  Return the selector for a function with %%name%% and %%params%%.
   */
  static getSelector(name, params) {
    params = (params || []).map((p) => ParamType.from(p));
    const fragment = new _FunctionFragment(_guard4, name, "view", params, [], null);
    return fragment.selector;
  }
  /**
   *  Returns a new **FunctionFragment** for %%obj%%.
   */
  static from(obj) {
    if (_FunctionFragment.isFragment(obj)) {
      return obj;
    }
    if (typeof obj === "string") {
      try {
        return _FunctionFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid function fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const name = consumeName("function", obj);
      const inputs = consumeParams(obj);
      const mutability = consumeMutability(obj);
      let outputs = [];
      if (consumeKeywords(obj, setify(["returns"])).has("returns")) {
        outputs = consumeParams(obj);
      }
      const gas = consumeGas(obj);
      consumeEoi(obj);
      return new _FunctionFragment(_guard4, name, mutability, inputs, outputs, gas);
    }
    let stateMutability = obj.stateMutability;
    if (stateMutability == null) {
      stateMutability = "payable";
      if (typeof obj.constant === "boolean") {
        stateMutability = "view";
        if (!obj.constant) {
          stateMutability = "payable";
          if (typeof obj.payable === "boolean" && !obj.payable) {
            stateMutability = "nonpayable";
          }
        }
      } else if (typeof obj.payable === "boolean" && !obj.payable) {
        stateMutability = "nonpayable";
      }
    }
    return new _FunctionFragment(_guard4, obj.name, stateMutability, obj.inputs ? obj.inputs.map(ParamType.from) : [], obj.outputs ? obj.outputs.map(ParamType.from) : [], obj.gas != null ? obj.gas : null);
  }
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **FunctionFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === FunctionFragmentInternal;
  }
};
var StructFragment = class _StructFragment extends NamedFragment {
  /**
   *  @private
   */
  constructor(guard, name, inputs) {
    super(guard, "struct", name, inputs);
    Object.defineProperty(this, internal, { value: StructFragmentInternal });
  }
  /**
   *  Returns a string representation of this struct as %%format%%.
   */
  format() {
    throw new Error("@TODO");
  }
  /**
   *  Returns a new **StructFragment** for %%obj%%.
   */
  static from(obj) {
    if (typeof obj === "string") {
      try {
        return _StructFragment.from(lex(obj));
      } catch (error) {
        assertArgument(false, "invalid struct fragment", "obj", obj);
      }
    } else if (obj instanceof TokenString) {
      const name = consumeName("struct", obj);
      const inputs = consumeParams(obj);
      consumeEoi(obj);
      return new _StructFragment(_guard4, name, inputs);
    }
    return new _StructFragment(_guard4, obj.name, obj.inputs ? obj.inputs.map(ParamType.from) : []);
  }
  // @TODO: fix this return type
  /**
   *  Returns ``true`` and provides a type guard if %%value%% is a
   *  **StructFragment**.
   */
  static isFragment(value) {
    return value && value[internal] === StructFragmentInternal;
  }
};

// node_modules/ethers/lib.esm/abi/abi-coder.js
var PanicReasons = /* @__PURE__ */ new Map();
PanicReasons.set(0, "GENERIC_PANIC");
PanicReasons.set(1, "ASSERT_FALSE");
PanicReasons.set(17, "OVERFLOW");
PanicReasons.set(18, "DIVIDE_BY_ZERO");
PanicReasons.set(33, "ENUM_RANGE_ERROR");
PanicReasons.set(34, "BAD_STORAGE_DATA");
PanicReasons.set(49, "STACK_UNDERFLOW");
PanicReasons.set(50, "ARRAY_RANGE_ERROR");
PanicReasons.set(65, "OUT_OF_MEMORY");
PanicReasons.set(81, "UNINITIALIZED_FUNCTION_CALL");
var paramTypeBytes = new RegExp(/^bytes([0-9]*)$/);
var paramTypeNumber = new RegExp(/^(u?int)([0-9]*)$/);
var defaultCoder = null;
var defaultMaxInflation = 1024;
function getBuiltinCallException(action, tx, data, abiCoder) {
  let message = "missing revert data";
  let reason = null;
  const invocation = null;
  let revert = null;
  if (data) {
    message = "execution reverted";
    const bytes2 = getBytes(data);
    data = hexlify(data);
    if (bytes2.length === 0) {
      message += " (no data present; likely require(false) occurred";
      reason = "require(false)";
    } else if (bytes2.length % 32 !== 4) {
      message += " (could not decode reason; invalid data length)";
    } else if (hexlify(bytes2.slice(0, 4)) === "0x08c379a0") {
      try {
        reason = abiCoder.decode(["string"], bytes2.slice(4))[0];
        revert = {
          signature: "Error(string)",
          name: "Error",
          args: [reason]
        };
        message += `: ${JSON.stringify(reason)}`;
      } catch (error) {
        message += " (could not decode reason; invalid string data)";
      }
    } else if (hexlify(bytes2.slice(0, 4)) === "0x4e487b71") {
      try {
        const code = Number(abiCoder.decode(["uint256"], bytes2.slice(4))[0]);
        revert = {
          signature: "Panic(uint256)",
          name: "Panic",
          args: [code]
        };
        reason = `Panic due to ${PanicReasons.get(code) || "UNKNOWN"}(${code})`;
        message += `: ${reason}`;
      } catch (error) {
        message += " (could not decode panic code)";
      }
    } else {
      message += " (unknown custom error)";
    }
  }
  const transaction = {
    to: tx.to ? getAddress(tx.to) : null,
    data: tx.data || "0x"
  };
  if (tx.from) {
    transaction.from = getAddress(tx.from);
  }
  return makeError(message, "CALL_EXCEPTION", {
    action,
    data,
    reason,
    transaction,
    invocation,
    revert
  });
}
var AbiCoder = class _AbiCoder {
  #getCoder(param) {
    if (param.isArray()) {
      return new ArrayCoder(this.#getCoder(param.arrayChildren), param.arrayLength, param.name);
    }
    if (param.isTuple()) {
      return new TupleCoder(param.components.map((c) => this.#getCoder(c)), param.name);
    }
    switch (param.baseType) {
      case "address":
        return new AddressCoder(param.name);
      case "bool":
        return new BooleanCoder(param.name);
      case "string":
        return new StringCoder(param.name);
      case "bytes":
        return new BytesCoder(param.name);
      case "":
        return new NullCoder(param.name);
    }
    let match = param.type.match(paramTypeNumber);
    if (match) {
      let size = parseInt(match[2] || "256");
      assertArgument(size !== 0 && size <= 256 && size % 8 === 0, "invalid " + match[1] + " bit length", "param", param);
      return new NumberCoder(size / 8, match[1] === "int", param.name);
    }
    match = param.type.match(paramTypeBytes);
    if (match) {
      let size = parseInt(match[1]);
      assertArgument(size !== 0 && size <= 32, "invalid bytes length", "param", param);
      return new FixedBytesCoder(size, param.name);
    }
    assertArgument(false, "invalid type", "type", param.type);
  }
  /**
   *  Get the default values for the given %%types%%.
   *
   *  For example, a ``uint`` is by default ``0`` and ``bool``
   *  is by default ``false``.
   */
  getDefaultValue(types) {
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    return coder.defaultValue();
  }
  /**
   *  Encode the %%values%% as the %%types%% into ABI data.
   *
   *  @returns DataHexstring
   */
  encode(types, values) {
    assertArgumentCount(values.length, types.length, "types/values length mismatch");
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    const writer = new Writer();
    coder.encode(writer, values);
    return writer.data;
  }
  /**
   *  Decode the ABI %%data%% as the %%types%% into values.
   *
   *  If %%loose%% decoding is enabled, then strict padding is
   *  not enforced. Some older versions of Solidity incorrectly
   *  padded event data emitted from ``external`` functions.
   */
  decode(types, data, loose) {
    const coders = types.map((type) => this.#getCoder(ParamType.from(type)));
    const coder = new TupleCoder(coders, "_");
    return coder.decode(new Reader(data, loose, defaultMaxInflation));
  }
  static _setDefaultMaxInflation(value) {
    assertArgument(typeof value === "number" && Number.isInteger(value), "invalid defaultMaxInflation factor", "value", value);
    defaultMaxInflation = value;
  }
  /**
   *  Returns the shared singleton instance of a default [[AbiCoder]].
   *
   *  On the first call, the instance is created internally.
   */
  static defaultAbiCoder() {
    if (defaultCoder == null) {
      defaultCoder = new _AbiCoder();
    }
    return defaultCoder;
  }
  /**
   *  Returns an ethers-compatible [[CallExceptionError]] Error for the given
   *  result %%data%% for the [[CallExceptionAction]] %%action%% against
   *  the Transaction %%tx%%.
   */
  static getBuiltinCallException(action, tx, data) {
    return getBuiltinCallException(action, tx, data, _AbiCoder.defaultAbiCoder());
  }
};

// node_modules/ethers/lib.esm/abi/interface.js
var LogDescription = class {
  /**
   *  The matching fragment for the ``topic0``.
   */
  fragment;
  /**
   *  The name of the Event.
   */
  name;
  /**
   *  The full Event signature.
   */
  signature;
  /**
   *  The topic hash for the Event.
   */
  topic;
  /**
   *  The arguments passed into the Event with ``emit``.
   */
  args;
  /**
   *  @_ignore:
   */
  constructor(fragment, topic, args) {
    const name = fragment.name, signature = fragment.format();
    defineProperties(this, {
      fragment,
      name,
      signature,
      topic,
      args
    });
  }
};
var TransactionDescription = class {
  /**
   *  The matching fragment from the transaction ``data``.
   */
  fragment;
  /**
   *  The name of the Function from the transaction ``data``.
   */
  name;
  /**
   *  The arguments passed to the Function from the transaction ``data``.
   */
  args;
  /**
   *  The full Function signature from the transaction ``data``.
   */
  signature;
  /**
   *  The selector for the Function from the transaction ``data``.
   */
  selector;
  /**
   *  The ``value`` (in wei) from the transaction.
   */
  value;
  /**
   *  @_ignore:
   */
  constructor(fragment, selector, args, value) {
    const name = fragment.name, signature = fragment.format();
    defineProperties(this, {
      fragment,
      name,
      args,
      signature,
      selector,
      value
    });
  }
};
var ErrorDescription = class {
  /**
   *  The matching fragment.
   */
  fragment;
  /**
   *  The name of the Error.
   */
  name;
  /**
   *  The arguments passed to the Error with ``revert``.
   */
  args;
  /**
   *  The full Error signature.
   */
  signature;
  /**
   *  The selector for the Error.
   */
  selector;
  /**
   *  @_ignore:
   */
  constructor(fragment, selector, args) {
    const name = fragment.name, signature = fragment.format();
    defineProperties(this, {
      fragment,
      name,
      args,
      signature,
      selector
    });
  }
};
var Indexed = class {
  /**
   *  The ``keccak256`` of the value logged.
   */
  hash;
  /**
   *  @_ignore:
   */
  _isIndexed;
  /**
   *  Returns ``true`` if %%value%% is an **Indexed**.
   *
   *  This provides a Type Guard for property access.
   */
  static isIndexed(value) {
    return !!(value && value._isIndexed);
  }
  /**
   *  @_ignore:
   */
  constructor(hash2) {
    defineProperties(this, { hash: hash2, _isIndexed: true });
  }
};
var PanicReasons2 = {
  "0": "generic panic",
  "1": "assert(false)",
  "17": "arithmetic overflow",
  "18": "division or modulo by zero",
  "33": "enum overflow",
  "34": "invalid encoded storage byte array accessed",
  "49": "out-of-bounds array access; popping on an empty array",
  "50": "out-of-bounds access of an array or bytesN",
  "65": "out of memory",
  "81": "uninitialized function"
};
var BuiltinErrors = {
  "0x08c379a0": {
    signature: "Error(string)",
    name: "Error",
    inputs: ["string"],
    reason: (message) => {
      return `reverted with reason string ${JSON.stringify(message)}`;
    }
  },
  "0x4e487b71": {
    signature: "Panic(uint256)",
    name: "Panic",
    inputs: ["uint256"],
    reason: (code) => {
      let reason = "unknown panic code";
      if (code >= 0 && code <= 255 && PanicReasons2[code.toString()]) {
        reason = PanicReasons2[code.toString()];
      }
      return `reverted with panic code 0x${code.toString(16)} (${reason})`;
    }
  }
};
var Interface = class _Interface {
  /**
   *  All the Contract ABI members (i.e. methods, events, errors, etc).
   */
  fragments;
  /**
   *  The Contract constructor.
   */
  deploy;
  /**
   *  The Fallback method, if any.
   */
  fallback;
  /**
   *  If receiving ether is supported.
   */
  receive;
  #errors;
  #events;
  #functions;
  //    #structs: Map<string, StructFragment>;
  #abiCoder;
  /**
   *  Create a new Interface for the %%fragments%%.
   */
  constructor(fragments) {
    let abi = [];
    if (typeof fragments === "string") {
      abi = JSON.parse(fragments);
    } else {
      abi = fragments;
    }
    this.#functions = /* @__PURE__ */ new Map();
    this.#errors = /* @__PURE__ */ new Map();
    this.#events = /* @__PURE__ */ new Map();
    const frags = [];
    for (const a of abi) {
      try {
        frags.push(Fragment.from(a));
      } catch (error) {
        console.log(`[Warning] Invalid Fragment ${JSON.stringify(a)}:`, error.message);
      }
    }
    defineProperties(this, {
      fragments: Object.freeze(frags)
    });
    let fallback = null;
    let receive = false;
    this.#abiCoder = this.getAbiCoder();
    this.fragments.forEach((fragment, index) => {
      let bucket;
      switch (fragment.type) {
        case "constructor":
          if (this.deploy) {
            console.log("duplicate definition - constructor");
            return;
          }
          defineProperties(this, { deploy: fragment });
          return;
        case "fallback":
          if (fragment.inputs.length === 0) {
            receive = true;
          } else {
            assertArgument(!fallback || fragment.payable !== fallback.payable, "conflicting fallback fragments", `fragments[${index}]`, fragment);
            fallback = fragment;
            receive = fallback.payable;
          }
          return;
        case "function":
          bucket = this.#functions;
          break;
        case "event":
          bucket = this.#events;
          break;
        case "error":
          bucket = this.#errors;
          break;
        default:
          return;
      }
      const signature = fragment.format();
      if (bucket.has(signature)) {
        return;
      }
      bucket.set(signature, fragment);
    });
    if (!this.deploy) {
      defineProperties(this, {
        deploy: ConstructorFragment.from("constructor()")
      });
    }
    defineProperties(this, { fallback, receive });
  }
  /**
   *  Returns the entire Human-Readable ABI, as an array of
   *  signatures, optionally as %%minimal%% strings, which
   *  removes parameter names and unneceesary spaces.
   */
  format(minimal) {
    const format = minimal ? "minimal" : "full";
    const abi = this.fragments.map((f2) => f2.format(format));
    return abi;
  }
  /**
   *  Return the JSON-encoded ABI. This is the format Solidiy
   *  returns.
   */
  formatJson() {
    const abi = this.fragments.map((f2) => f2.format("json"));
    return JSON.stringify(abi.map((j) => JSON.parse(j)));
  }
  /**
   *  The ABI coder that will be used to encode and decode binary
   *  data.
   */
  getAbiCoder() {
    return AbiCoder.defaultAbiCoder();
  }
  // Find a function definition by any means necessary (unless it is ambiguous)
  #getFunction(key, values, forceUnique) {
    if (isHexString(key)) {
      const selector = key.toLowerCase();
      for (const fragment of this.#functions.values()) {
        if (selector === fragment.selector) {
          return fragment;
        }
      }
      return null;
    }
    if (key.indexOf("(") === -1) {
      const matching = [];
      for (const [name, fragment] of this.#functions) {
        if (name.split(
          "("
          /* fix:) */
        )[0] === key) {
          matching.push(fragment);
        }
      }
      if (values) {
        const lastValue = values.length > 0 ? values[values.length - 1] : null;
        let valueLength = values.length;
        let allowOptions = true;
        if (Typed.isTyped(lastValue) && lastValue.type === "overrides") {
          allowOptions = false;
          valueLength--;
        }
        for (let i = matching.length - 1; i >= 0; i--) {
          const inputs = matching[i].inputs.length;
          if (inputs !== valueLength && (!allowOptions || inputs !== valueLength - 1)) {
            matching.splice(i, 1);
          }
        }
        for (let i = matching.length - 1; i >= 0; i--) {
          const inputs = matching[i].inputs;
          for (let j = 0; j < values.length; j++) {
            if (!Typed.isTyped(values[j])) {
              continue;
            }
            if (j >= inputs.length) {
              if (values[j].type === "overrides") {
                continue;
              }
              matching.splice(i, 1);
              break;
            }
            if (values[j].type !== inputs[j].baseType) {
              matching.splice(i, 1);
              break;
            }
          }
        }
      }
      if (matching.length === 1 && values && values.length !== matching[0].inputs.length) {
        const lastArg = values[values.length - 1];
        if (lastArg == null || Array.isArray(lastArg) || typeof lastArg !== "object") {
          matching.splice(0, 1);
        }
      }
      if (matching.length === 0) {
        return null;
      }
      if (matching.length > 1 && forceUnique) {
        const matchStr = matching.map((m) => JSON.stringify(m.format())).join(", ");
        assertArgument(false, `ambiguous function description (i.e. matches ${matchStr})`, "key", key);
      }
      return matching[0];
    }
    const result2 = this.#functions.get(FunctionFragment.from(key).format());
    if (result2) {
      return result2;
    }
    return null;
  }
  /**
   *  Get the function name for %%key%%, which may be a function selector,
   *  function name or function signature that belongs to the ABI.
   */
  getFunctionName(key) {
    const fragment = this.#getFunction(key, null, false);
    assertArgument(fragment, "no matching function", "key", key);
    return fragment.name;
  }
  /**
   *  Returns true if %%key%% (a function selector, function name or
   *  function signature) is present in the ABI.
   *
   *  In the case of a function name, the name may be ambiguous, so
   *  accessing the [[FunctionFragment]] may require refinement.
   */
  hasFunction(key) {
    return !!this.#getFunction(key, null, false);
  }
  /**
   *  Get the [[FunctionFragment]] for %%key%%, which may be a function
   *  selector, function name or function signature that belongs to the ABI.
   *
   *  If %%values%% is provided, it will use the Typed API to handle
   *  ambiguous cases where multiple functions match by name.
   *
   *  If the %%key%% and %%values%% do not refine to a single function in
   *  the ABI, this will throw.
   */
  getFunction(key, values) {
    return this.#getFunction(key, values || null, true);
  }
  /**
   *  Iterate over all functions, calling %%callback%%, sorted by their name.
   */
  forEachFunction(callback) {
    const names2 = Array.from(this.#functions.keys());
    names2.sort((a, b2) => a.localeCompare(b2));
    for (let i = 0; i < names2.length; i++) {
      const name = names2[i];
      callback(this.#functions.get(name), i);
    }
  }
  // Find an event definition by any means necessary (unless it is ambiguous)
  #getEvent(key, values, forceUnique) {
    if (isHexString(key)) {
      const eventTopic = key.toLowerCase();
      for (const fragment of this.#events.values()) {
        if (eventTopic === fragment.topicHash) {
          return fragment;
        }
      }
      return null;
    }
    if (key.indexOf("(") === -1) {
      const matching = [];
      for (const [name, fragment] of this.#events) {
        if (name.split(
          "("
          /* fix:) */
        )[0] === key) {
          matching.push(fragment);
        }
      }
      if (values) {
        for (let i = matching.length - 1; i >= 0; i--) {
          if (matching[i].inputs.length < values.length) {
            matching.splice(i, 1);
          }
        }
        for (let i = matching.length - 1; i >= 0; i--) {
          const inputs = matching[i].inputs;
          for (let j = 0; j < values.length; j++) {
            if (!Typed.isTyped(values[j])) {
              continue;
            }
            if (values[j].type !== inputs[j].baseType) {
              matching.splice(i, 1);
              break;
            }
          }
        }
      }
      if (matching.length === 0) {
        return null;
      }
      if (matching.length > 1 && forceUnique) {
        const matchStr = matching.map((m) => JSON.stringify(m.format())).join(", ");
        assertArgument(false, `ambiguous event description (i.e. matches ${matchStr})`, "key", key);
      }
      return matching[0];
    }
    const result2 = this.#events.get(EventFragment.from(key).format());
    if (result2) {
      return result2;
    }
    return null;
  }
  /**
   *  Get the event name for %%key%%, which may be a topic hash,
   *  event name or event signature that belongs to the ABI.
   */
  getEventName(key) {
    const fragment = this.#getEvent(key, null, false);
    assertArgument(fragment, "no matching event", "key", key);
    return fragment.name;
  }
  /**
   *  Returns true if %%key%% (an event topic hash, event name or
   *  event signature) is present in the ABI.
   *
   *  In the case of an event name, the name may be ambiguous, so
   *  accessing the [[EventFragment]] may require refinement.
   */
  hasEvent(key) {
    return !!this.#getEvent(key, null, false);
  }
  /**
   *  Get the [[EventFragment]] for %%key%%, which may be a topic hash,
   *  event name or event signature that belongs to the ABI.
   *
   *  If %%values%% is provided, it will use the Typed API to handle
   *  ambiguous cases where multiple events match by name.
   *
   *  If the %%key%% and %%values%% do not refine to a single event in
   *  the ABI, this will throw.
   */
  getEvent(key, values) {
    return this.#getEvent(key, values || null, true);
  }
  /**
   *  Iterate over all events, calling %%callback%%, sorted by their name.
   */
  forEachEvent(callback) {
    const names2 = Array.from(this.#events.keys());
    names2.sort((a, b2) => a.localeCompare(b2));
    for (let i = 0; i < names2.length; i++) {
      const name = names2[i];
      callback(this.#events.get(name), i);
    }
  }
  /**
   *  Get the [[ErrorFragment]] for %%key%%, which may be an error
   *  selector, error name or error signature that belongs to the ABI.
   *
   *  If %%values%% is provided, it will use the Typed API to handle
   *  ambiguous cases where multiple errors match by name.
   *
   *  If the %%key%% and %%values%% do not refine to a single error in
   *  the ABI, this will throw.
   */
  getError(key, values) {
    if (isHexString(key)) {
      const selector = key.toLowerCase();
      if (BuiltinErrors[selector]) {
        return ErrorFragment.from(BuiltinErrors[selector].signature);
      }
      for (const fragment of this.#errors.values()) {
        if (selector === fragment.selector) {
          return fragment;
        }
      }
      return null;
    }
    if (key.indexOf("(") === -1) {
      const matching = [];
      for (const [name, fragment] of this.#errors) {
        if (name.split(
          "("
          /* fix:) */
        )[0] === key) {
          matching.push(fragment);
        }
      }
      if (matching.length === 0) {
        if (key === "Error") {
          return ErrorFragment.from("error Error(string)");
        }
        if (key === "Panic") {
          return ErrorFragment.from("error Panic(uint256)");
        }
        return null;
      } else if (matching.length > 1) {
        const matchStr = matching.map((m) => JSON.stringify(m.format())).join(", ");
        assertArgument(false, `ambiguous error description (i.e. ${matchStr})`, "name", key);
      }
      return matching[0];
    }
    key = ErrorFragment.from(key).format();
    if (key === "Error(string)") {
      return ErrorFragment.from("error Error(string)");
    }
    if (key === "Panic(uint256)") {
      return ErrorFragment.from("error Panic(uint256)");
    }
    const result2 = this.#errors.get(key);
    if (result2) {
      return result2;
    }
    return null;
  }
  /**
   *  Iterate over all errors, calling %%callback%%, sorted by their name.
   */
  forEachError(callback) {
    const names2 = Array.from(this.#errors.keys());
    names2.sort((a, b2) => a.localeCompare(b2));
    for (let i = 0; i < names2.length; i++) {
      const name = names2[i];
      callback(this.#errors.get(name), i);
    }
  }
  // Get the 4-byte selector used by Solidity to identify a function
  /*
  getSelector(fragment: ErrorFragment | FunctionFragment): string {
      if (typeof(fragment) === "string") {
          const matches: Array<Fragment> = [ ];
  
          try { matches.push(this.getFunction(fragment)); } catch (error) { }
          try { matches.push(this.getError(<string>fragment)); } catch (_) { }
  
          if (matches.length === 0) {
              logger.throwArgumentError("unknown fragment", "key", fragment);
          } else if (matches.length > 1) {
              logger.throwArgumentError("ambiguous fragment matches function and error", "key", fragment);
          }
  
          fragment = matches[0];
      }
  
      return dataSlice(id(fragment.format()), 0, 4);
  }
      */
  // Get the 32-byte topic hash used by Solidity to identify an event
  /*
  getEventTopic(fragment: EventFragment): string {
      //if (typeof(fragment) === "string") { fragment = this.getEvent(eventFragment); }
      return id(fragment.format());
  }
  */
  _decodeParams(params, data) {
    return this.#abiCoder.decode(params, data);
  }
  _encodeParams(params, values) {
    return this.#abiCoder.encode(params, values);
  }
  /**
   *  Encodes a ``tx.data`` object for deploying the Contract with
   *  the %%values%% as the constructor arguments.
   */
  encodeDeploy(values) {
    return this._encodeParams(this.deploy.inputs, values || []);
  }
  /**
   *  Decodes the result %%data%% (e.g. from an ``eth_call``) for the
   *  specified error (see [[getError]] for valid values for
   *  %%key%%).
   *
   *  Most developers should prefer the [[parseCallResult]] method instead,
   *  which will automatically detect a ``CALL_EXCEPTION`` and throw the
   *  corresponding error.
   */
  decodeErrorResult(fragment, data) {
    if (typeof fragment === "string") {
      const f2 = this.getError(fragment);
      assertArgument(f2, "unknown error", "fragment", fragment);
      fragment = f2;
    }
    assertArgument(dataSlice(data, 0, 4) === fragment.selector, `data signature does not match error ${fragment.name}.`, "data", data);
    return this._decodeParams(fragment.inputs, dataSlice(data, 4));
  }
  /**
   *  Encodes the transaction revert data for a call result that
   *  reverted from the the Contract with the sepcified %%error%%
   *  (see [[getError]] for valid values for %%fragment%%) with the %%values%%.
   *
   *  This is generally not used by most developers, unless trying to mock
   *  a result from a Contract.
   */
  encodeErrorResult(fragment, values) {
    if (typeof fragment === "string") {
      const f2 = this.getError(fragment);
      assertArgument(f2, "unknown error", "fragment", fragment);
      fragment = f2;
    }
    return concat([
      fragment.selector,
      this._encodeParams(fragment.inputs, values || [])
    ]);
  }
  /**
   *  Decodes the %%data%% from a transaction ``tx.data`` for
   *  the function specified (see [[getFunction]] for valid values
   *  for %%fragment%%).
   *
   *  Most developers should prefer the [[parseTransaction]] method
   *  instead, which will automatically detect the fragment.
   */
  decodeFunctionData(fragment, data) {
    if (typeof fragment === "string") {
      const f2 = this.getFunction(fragment);
      assertArgument(f2, "unknown function", "fragment", fragment);
      fragment = f2;
    }
    assertArgument(dataSlice(data, 0, 4) === fragment.selector, `data signature does not match function ${fragment.name}.`, "data", data);
    return this._decodeParams(fragment.inputs, dataSlice(data, 4));
  }
  /**
   *  Encodes the ``tx.data`` for a transaction that calls the function
   *  specified (see [[getFunction]] for valid values for %%fragment%%) with
   *  the %%values%%.
   */
  encodeFunctionData(fragment, values) {
    if (typeof fragment === "string") {
      const f2 = this.getFunction(fragment);
      assertArgument(f2, "unknown function", "fragment", fragment);
      fragment = f2;
    }
    return concat([
      fragment.selector,
      this._encodeParams(fragment.inputs, values || [])
    ]);
  }
  /**
   *  Decodes the result %%data%% (e.g. from an ``eth_call``) for the
   *  specified function (see [[getFunction]] for valid values for
   *  %%key%%).
   *
   *  Most developers should prefer the [[parseCallResult]] method instead,
   *  which will automatically detect a ``CALL_EXCEPTION`` and throw the
   *  corresponding error.
   */
  decodeFunctionResult(fragment, data) {
    if (typeof fragment === "string") {
      const f2 = this.getFunction(fragment);
      assertArgument(f2, "unknown function", "fragment", fragment);
      fragment = f2;
    }
    let message = "invalid length for result data";
    const bytes2 = getBytesCopy(data);
    if (bytes2.length % 32 === 0) {
      try {
        return this.#abiCoder.decode(fragment.outputs, bytes2);
      } catch (error) {
        message = "could not decode result data";
      }
    }
    assert(false, message, "BAD_DATA", {
      value: hexlify(bytes2),
      info: { method: fragment.name, signature: fragment.format() }
    });
  }
  makeError(_data, tx) {
    const data = getBytes(_data, "data");
    const error = AbiCoder.getBuiltinCallException("call", tx, data);
    const customPrefix = "execution reverted (unknown custom error)";
    if (error.message.startsWith(customPrefix)) {
      const selector = hexlify(data.slice(0, 4));
      const ef = this.getError(selector);
      if (ef) {
        try {
          const args = this.#abiCoder.decode(ef.inputs, data.slice(4));
          error.revert = {
            name: ef.name,
            signature: ef.format(),
            args
          };
          error.reason = error.revert.signature;
          error.message = `execution reverted: ${error.reason}`;
        } catch (e) {
          error.message = `execution reverted (coult not decode custom error)`;
        }
      }
    }
    const parsed = this.parseTransaction(tx);
    if (parsed) {
      error.invocation = {
        method: parsed.name,
        signature: parsed.signature,
        args: parsed.args
      };
    }
    return error;
  }
  /**
   *  Encodes the result data (e.g. from an ``eth_call``) for the
   *  specified function (see [[getFunction]] for valid values
   *  for %%fragment%%) with %%values%%.
   *
   *  This is generally not used by most developers, unless trying to mock
   *  a result from a Contract.
   */
  encodeFunctionResult(fragment, values) {
    if (typeof fragment === "string") {
      const f2 = this.getFunction(fragment);
      assertArgument(f2, "unknown function", "fragment", fragment);
      fragment = f2;
    }
    return hexlify(this.#abiCoder.encode(fragment.outputs, values || []));
  }
  /*
      spelunk(inputs: Array<ParamType>, values: ReadonlyArray<any>, processfunc: (type: string, value: any) => Promise<any>): Promise<Array<any>> {
          const promises: Array<Promise<>> = [ ];
          const process = function(type: ParamType, value: any): any {
              if (type.baseType === "array") {
                  return descend(type.child
              }
              if (type. === "address") {
              }
          };
  
          const descend = function (inputs: Array<ParamType>, values: ReadonlyArray<any>) {
              if (inputs.length !== values.length) { throw new Error("length mismatch"); }
              
          };
  
          const result: Array<any> = [ ];
          values.forEach((value, index) => {
              if (value == null) {
                  topics.push(null);
              } else if (param.baseType === "array" || param.baseType === "tuple") {
                  logger.throwArgumentError("filtering with tuples or arrays not supported", ("contract." + param.name), value);
              } else if (Array.isArray(value)) {
                  topics.push(value.map((value) => encodeTopic(param, value)));
              } else {
                  topics.push(encodeTopic(param, value));
              }
          });
      }
  */
  // Create the filter for the event with search criteria (e.g. for eth_filterLog)
  encodeFilterTopics(fragment, values) {
    if (typeof fragment === "string") {
      const f2 = this.getEvent(fragment);
      assertArgument(f2, "unknown event", "eventFragment", fragment);
      fragment = f2;
    }
    assert(values.length <= fragment.inputs.length, `too many arguments for ${fragment.format()}`, "UNEXPECTED_ARGUMENT", { count: values.length, expectedCount: fragment.inputs.length });
    const topics = [];
    if (!fragment.anonymous) {
      topics.push(fragment.topicHash);
    }
    const encodeTopic = (param, value) => {
      if (param.type === "string") {
        return id(value);
      } else if (param.type === "bytes") {
        return keccak256(hexlify(value));
      }
      if (param.type === "bool" && typeof value === "boolean") {
        value = value ? "0x01" : "0x00";
      } else if (param.type.match(/^u?int/)) {
        value = toBeHex(value);
      } else if (param.type.match(/^bytes/)) {
        value = zeroPadBytes(value, 32);
      } else if (param.type === "address") {
        this.#abiCoder.encode(["address"], [value]);
      }
      return zeroPadValue(hexlify(value), 32);
    };
    values.forEach((value, index) => {
      const param = fragment.inputs[index];
      if (!param.indexed) {
        assertArgument(value == null, "cannot filter non-indexed parameters; must be null", "contract." + param.name, value);
        return;
      }
      if (value == null) {
        topics.push(null);
      } else if (param.baseType === "array" || param.baseType === "tuple") {
        assertArgument(false, "filtering with tuples or arrays not supported", "contract." + param.name, value);
      } else if (Array.isArray(value)) {
        topics.push(value.map((value2) => encodeTopic(param, value2)));
      } else {
        topics.push(encodeTopic(param, value));
      }
    });
    while (topics.length && topics[topics.length - 1] === null) {
      topics.pop();
    }
    return topics;
  }
  encodeEventLog(fragment, values) {
    if (typeof fragment === "string") {
      const f2 = this.getEvent(fragment);
      assertArgument(f2, "unknown event", "eventFragment", fragment);
      fragment = f2;
    }
    const topics = [];
    const dataTypes = [];
    const dataValues = [];
    if (!fragment.anonymous) {
      topics.push(fragment.topicHash);
    }
    assertArgument(values.length === fragment.inputs.length, "event arguments/values mismatch", "values", values);
    fragment.inputs.forEach((param, index) => {
      const value = values[index];
      if (param.indexed) {
        if (param.type === "string") {
          topics.push(id(value));
        } else if (param.type === "bytes") {
          topics.push(keccak256(value));
        } else if (param.baseType === "tuple" || param.baseType === "array") {
          throw new Error("not implemented");
        } else {
          topics.push(this.#abiCoder.encode([param.type], [value]));
        }
      } else {
        dataTypes.push(param);
        dataValues.push(value);
      }
    });
    return {
      data: this.#abiCoder.encode(dataTypes, dataValues),
      topics
    };
  }
  // Decode a filter for the event and the search criteria
  decodeEventLog(fragment, data, topics) {
    if (typeof fragment === "string") {
      const f2 = this.getEvent(fragment);
      assertArgument(f2, "unknown event", "eventFragment", fragment);
      fragment = f2;
    }
    if (topics != null && !fragment.anonymous) {
      const eventTopic = fragment.topicHash;
      assertArgument(isHexString(topics[0], 32) && topics[0].toLowerCase() === eventTopic, "fragment/topic mismatch", "topics[0]", topics[0]);
      topics = topics.slice(1);
    }
    const indexed = [];
    const nonIndexed = [];
    const dynamic = [];
    fragment.inputs.forEach((param, index) => {
      if (param.indexed) {
        if (param.type === "string" || param.type === "bytes" || param.baseType === "tuple" || param.baseType === "array") {
          indexed.push(ParamType.from({ type: "bytes32", name: param.name }));
          dynamic.push(true);
        } else {
          indexed.push(param);
          dynamic.push(false);
        }
      } else {
        nonIndexed.push(param);
        dynamic.push(false);
      }
    });
    const resultIndexed = topics != null ? this.#abiCoder.decode(indexed, concat(topics)) : null;
    const resultNonIndexed = this.#abiCoder.decode(nonIndexed, data, true);
    const values = [];
    const keys = [];
    let nonIndexedIndex = 0, indexedIndex = 0;
    fragment.inputs.forEach((param, index) => {
      let value = null;
      if (param.indexed) {
        if (resultIndexed == null) {
          value = new Indexed(null);
        } else if (dynamic[index]) {
          value = new Indexed(resultIndexed[indexedIndex++]);
        } else {
          try {
            value = resultIndexed[indexedIndex++];
          } catch (error) {
            value = error;
          }
        }
      } else {
        try {
          value = resultNonIndexed[nonIndexedIndex++];
        } catch (error) {
          value = error;
        }
      }
      values.push(value);
      keys.push(param.name || null);
    });
    return Result.fromItems(values, keys);
  }
  /**
   *  Parses a transaction, finding the matching function and extracts
   *  the parameter values along with other useful function details.
   *
   *  If the matching function cannot be found, return null.
   */
  parseTransaction(tx) {
    const data = getBytes(tx.data, "tx.data");
    const value = getBigInt(tx.value != null ? tx.value : 0, "tx.value");
    const fragment = this.getFunction(hexlify(data.slice(0, 4)));
    if (!fragment) {
      return null;
    }
    const args = this.#abiCoder.decode(fragment.inputs, data.slice(4));
    return new TransactionDescription(fragment, fragment.selector, args, value);
  }
  parseCallResult(data) {
    throw new Error("@TODO");
  }
  /**
   *  Parses a receipt log, finding the matching event and extracts
   *  the parameter values along with other useful event details.
   *
   *  If the matching event cannot be found, returns null.
   */
  parseLog(log) {
    const fragment = this.getEvent(log.topics[0]);
    if (!fragment || fragment.anonymous) {
      return null;
    }
    return new LogDescription(fragment, fragment.topicHash, this.decodeEventLog(fragment, log.data, log.topics));
  }
  /**
   *  Parses a revert data, finding the matching error and extracts
   *  the parameter values along with other useful error details.
   *
   *  If the matching error cannot be found, returns null.
   */
  parseError(data) {
    const hexData = hexlify(data);
    const fragment = this.getError(dataSlice(hexData, 0, 4));
    if (!fragment) {
      return null;
    }
    const args = this.#abiCoder.decode(fragment.inputs, dataSlice(hexData, 4));
    return new ErrorDescription(fragment, fragment.selector, args);
  }
  /**
   *  Creates a new [[Interface]] from the ABI %%value%%.
   *
   *  The %%value%% may be provided as an existing [[Interface]] object,
   *  a JSON-encoded ABI or any Human-Readable ABI format.
   */
  static from(value) {
    if (value instanceof _Interface) {
      return value;
    }
    if (typeof value === "string") {
      return new _Interface(JSON.parse(value));
    }
    if (typeof value.formatJson === "function") {
      return new _Interface(value.formatJson());
    }
    if (typeof value.format === "function") {
      return new _Interface(value.format("json"));
    }
    return new _Interface(value);
  }
};

// node_modules/ethers/lib.esm/providers/provider.js
var BN_09 = BigInt(0);
function getValue2(value) {
  if (value == null) {
    return null;
  }
  return value;
}
function toJson(value) {
  if (value == null) {
    return null;
  }
  return value.toString();
}
var FeeData = class {
  /**
   *  The gas price for legacy networks.
   */
  gasPrice;
  /**
   *  The maximum fee to pay per gas.
   *
   *  The base fee per gas is defined by the network and based on
   *  congestion, increasing the cost during times of heavy load
   *  and lowering when less busy.
   *
   *  The actual fee per gas will be the base fee for the block
   *  and the priority fee, up to the max fee per gas.
   *
   *  This will be ``null`` on legacy networks (i.e. [pre-EIP-1559](link-eip-1559))
   */
  maxFeePerGas;
  /**
   *  The additional amout to pay per gas to encourage a validator
   *  to include the transaction.
   *
   *  The purpose of this is to compensate the validator for the
   *  adjusted risk for including a given transaction.
   *
   *  This will be ``null`` on legacy networks (i.e. [pre-EIP-1559](link-eip-1559))
   */
  maxPriorityFeePerGas;
  /**
   *  Creates a new FeeData for %%gasPrice%%, %%maxFeePerGas%% and
   *  %%maxPriorityFeePerGas%%.
   */
  constructor(gasPrice, maxFeePerGas, maxPriorityFeePerGas) {
    defineProperties(this, {
      gasPrice: getValue2(gasPrice),
      maxFeePerGas: getValue2(maxFeePerGas),
      maxPriorityFeePerGas: getValue2(maxPriorityFeePerGas)
    });
  }
  /**
   *  Returns a JSON-friendly value.
   */
  toJSON() {
    const { gasPrice, maxFeePerGas, maxPriorityFeePerGas } = this;
    return {
      _type: "FeeData",
      gasPrice: toJson(gasPrice),
      maxFeePerGas: toJson(maxFeePerGas),
      maxPriorityFeePerGas: toJson(maxPriorityFeePerGas)
    };
  }
};
function copyRequest(req) {
  const result2 = {};
  if (req.to) {
    result2.to = req.to;
  }
  if (req.from) {
    result2.from = req.from;
  }
  if (req.data) {
    result2.data = hexlify(req.data);
  }
  const bigIntKeys = "chainId,gasLimit,gasPrice,maxFeePerBlobGas,maxFeePerGas,maxPriorityFeePerGas,value".split(/,/);
  for (const key of bigIntKeys) {
    if (!(key in req) || req[key] == null) {
      continue;
    }
    result2[key] = getBigInt(req[key], `request.${key}`);
  }
  const numberKeys = "type,nonce".split(/,/);
  for (const key of numberKeys) {
    if (!(key in req) || req[key] == null) {
      continue;
    }
    result2[key] = getNumber(req[key], `request.${key}`);
  }
  if (req.accessList) {
    result2.accessList = accessListify(req.accessList);
  }
  if (req.authorizationList) {
    result2.authorizationList = req.authorizationList.slice();
  }
  if ("blockTag" in req) {
    result2.blockTag = req.blockTag;
  }
  if ("enableCcipRead" in req) {
    result2.enableCcipRead = !!req.enableCcipRead;
  }
  if ("customData" in req) {
    result2.customData = req.customData;
  }
  if ("blobVersionedHashes" in req && req.blobVersionedHashes) {
    result2.blobVersionedHashes = req.blobVersionedHashes.slice();
  }
  if ("kzg" in req) {
    result2.kzg = req.kzg;
  }
  if ("blobWrapperVersion" in req) {
    result2.blobWrapperVersion = req.blobWrapperVersion;
  }
  if ("blobs" in req && req.blobs) {
    result2.blobs = req.blobs.map((b2) => {
      if (isBytesLike(b2)) {
        return hexlify(b2);
      }
      return Object.assign({}, b2);
    });
  }
  return result2;
}
var Block = class {
  /**
   *  The provider connected to the block used to fetch additional details
   *  if necessary.
   */
  provider;
  /**
   *  The block number, sometimes called the block height. This is a
   *  sequential number that is one higher than the parent block.
   */
  number;
  /**
   *  The block hash.
   *
   *  This hash includes all properties, so can be safely used to identify
   *  an exact set of block properties.
   */
  hash;
  /**
   *  The timestamp for this block, which is the number of seconds since
   *  epoch that this block was included.
   */
  timestamp;
  /**
   *  The block hash of the parent block.
   */
  parentHash;
  /**
   *  The hash tree root of the parent beacon block for the given
   *  execution block. See [[link-eip-4788]].
   */
  parentBeaconBlockRoot;
  /**
   *  The nonce.
   *
   *  On legacy networks, this is the random number inserted which
   *  permitted the difficulty target to be reached.
   */
  nonce;
  /**
   *  The difficulty target.
   *
   *  On legacy networks, this is the proof-of-work target required
   *  for a block to meet the protocol rules to be included.
   *
   *  On modern networks, this is a random number arrived at using
   *  randao.  @TODO: Find links?
   */
  difficulty;
  /**
   *  The total gas limit for this block.
   */
  gasLimit;
  /**
   *  The total gas used in this block.
   */
  gasUsed;
  /**
   *  The root hash for the global state after applying changes
   *  in this block.
   */
  stateRoot;
  /**
   *  The hash of the transaction receipts trie.
   */
  receiptsRoot;
  /**
   *  The hash of the transactions.
   */
  transactionsRoot;
  /**
   *  The total amount of blob gas consumed by the transactions
   *  within the block. See [[link-eip-4844]].
   */
  blobGasUsed;
  /**
   *  The running total of blob gas consumed in excess of the
   *  target, prior to the block. See [[link-eip-4844]].
   */
  excessBlobGas;
  /**
   *  The miner coinbase address, wihch receives any subsidies for
   *  including this block.
   */
  miner;
  /**
   *  The latest RANDAO mix of the post beacon state of
   *  the previous block.
   */
  prevRandao;
  /**
   *  Any extra data the validator wished to include.
   */
  extraData;
  /**
   *  The base fee per gas that all transactions in this block were
   *  charged.
   *
   *  This adjusts after each block, depending on how congested the network
   *  is.
   */
  baseFeePerGas;
  #transactions;
  /**
   *  Create a new **Block** object.
   *
   *  This should generally not be necessary as the unless implementing a
   *  low-level library.
   */
  constructor(block, provider) {
    this.#transactions = block.transactions.map((tx) => {
      if (typeof tx !== "string") {
        return new TransactionResponse(tx, provider);
      }
      return tx;
    });
    defineProperties(this, {
      provider,
      hash: getValue2(block.hash),
      number: block.number,
      timestamp: block.timestamp,
      parentHash: block.parentHash,
      parentBeaconBlockRoot: block.parentBeaconBlockRoot,
      nonce: block.nonce,
      difficulty: block.difficulty,
      gasLimit: block.gasLimit,
      gasUsed: block.gasUsed,
      blobGasUsed: block.blobGasUsed,
      excessBlobGas: block.excessBlobGas,
      miner: block.miner,
      prevRandao: getValue2(block.prevRandao),
      extraData: block.extraData,
      baseFeePerGas: getValue2(block.baseFeePerGas),
      stateRoot: block.stateRoot,
      receiptsRoot: block.receiptsRoot,
      transactionsRoot: block.transactionsRoot
    });
  }
  /**
   *  Returns the list of transaction hashes, in the order
   *  they were executed within the block.
   */
  get transactions() {
    return this.#transactions.map((tx) => {
      if (typeof tx === "string") {
        return tx;
      }
      return tx.hash;
    });
  }
  /**
   *  Returns the complete transactions, in the order they
   *  were executed within the block.
   *
   *  This is only available for blocks which prefetched
   *  transactions, by passing ``true`` to %%prefetchTxs%%
   *  into [[Provider-getBlock]].
   */
  get prefetchedTransactions() {
    const txs = this.#transactions.slice();
    if (txs.length === 0) {
      return [];
    }
    assert(typeof txs[0] === "object", "transactions were not prefetched with block request", "UNSUPPORTED_OPERATION", {
      operation: "transactionResponses()"
    });
    return txs;
  }
  /**
   *  Returns a JSON-friendly value.
   */
  toJSON() {
    const { baseFeePerGas, difficulty, extraData, gasLimit, gasUsed, hash: hash2, miner, prevRandao, nonce, number: number2, parentHash, parentBeaconBlockRoot, stateRoot, receiptsRoot, transactionsRoot, timestamp, transactions } = this;
    return {
      _type: "Block",
      baseFeePerGas: toJson(baseFeePerGas),
      difficulty: toJson(difficulty),
      extraData,
      gasLimit: toJson(gasLimit),
      gasUsed: toJson(gasUsed),
      blobGasUsed: toJson(this.blobGasUsed),
      excessBlobGas: toJson(this.excessBlobGas),
      hash: hash2,
      miner,
      prevRandao,
      nonce,
      number: number2,
      parentHash,
      timestamp,
      parentBeaconBlockRoot,
      stateRoot,
      receiptsRoot,
      transactionsRoot,
      transactions
    };
  }
  [Symbol.iterator]() {
    let index = 0;
    const txs = this.transactions;
    return {
      next: () => {
        if (index < this.length) {
          return {
            value: txs[index++],
            done: false
          };
        }
        return { value: void 0, done: true };
      }
    };
  }
  /**
   *  The number of transactions in this block.
   */
  get length() {
    return this.#transactions.length;
  }
  /**
   *  The [[link-js-date]] this block was included at.
   */
  get date() {
    if (this.timestamp == null) {
      return null;
    }
    return new Date(this.timestamp * 1e3);
  }
  /**
   *  Get the transaction at %%indexe%% within this block.
   */
  async getTransaction(indexOrHash) {
    let tx = void 0;
    if (typeof indexOrHash === "number") {
      tx = this.#transactions[indexOrHash];
    } else {
      const hash2 = indexOrHash.toLowerCase();
      for (const v of this.#transactions) {
        if (typeof v === "string") {
          if (v !== hash2) {
            continue;
          }
          tx = v;
          break;
        } else {
          if (v.hash !== hash2) {
            continue;
          }
          tx = v;
          break;
        }
      }
    }
    if (tx == null) {
      throw new Error("no such tx");
    }
    if (typeof tx === "string") {
      return await this.provider.getTransaction(tx);
    } else {
      return tx;
    }
  }
  /**
   *  If a **Block** was fetched with a request to include the transactions
   *  this will allow synchronous access to those transactions.
   *
   *  If the transactions were not prefetched, this will throw.
   */
  getPrefetchedTransaction(indexOrHash) {
    const txs = this.prefetchedTransactions;
    if (typeof indexOrHash === "number") {
      return txs[indexOrHash];
    }
    indexOrHash = indexOrHash.toLowerCase();
    for (const tx of txs) {
      if (tx.hash === indexOrHash) {
        return tx;
      }
    }
    assertArgument(false, "no matching transaction", "indexOrHash", indexOrHash);
  }
  /**
   *  Returns true if this block been mined. This provides a type guard
   *  for all properties on a [[MinedBlock]].
   */
  isMined() {
    return !!this.hash;
  }
  /**
   *  Returns true if this block is an [[link-eip-2930]] block.
   */
  isLondon() {
    return !!this.baseFeePerGas;
  }
  /**
   *  @_ignore:
   */
  orphanedEvent() {
    if (!this.isMined()) {
      throw new Error("");
    }
    return createOrphanedBlockFilter(this);
  }
};
var Log = class {
  /**
   *  The provider connected to the log used to fetch additional details
   *  if necessary.
   */
  provider;
  /**
   *  The transaction hash of the transaction this log occurred in. Use the
   *  [[Log-getTransaction]] to get the [[TransactionResponse]].
   */
  transactionHash;
  /**
   *  The block hash of the block this log occurred in. Use the
   *  [[Log-getBlock]] to get the [[Block]].
   */
  blockHash;
  /**
   *  The block number of the block this log occurred in. It is preferred
   *  to use the [[Block-hash]] when fetching the related [[Block]],
   *  since in the case of an orphaned block, the block at that height may
   *  have changed.
   */
  blockNumber;
  /**
   *  If the **Log** represents a block that was removed due to an orphaned
   *  block, this will be true.
   *
   *  This can only happen within an orphan event listener.
   */
  removed;
  /**
   *  The address of the contract that emitted this log.
   */
  address;
  /**
   *  The data included in this log when it was emitted.
   */
  data;
  /**
   *  The indexed topics included in this log when it was emitted.
   *
   *  All topics are included in the bloom filters, so they can be
   *  efficiently filtered using the [[Provider-getLogs]] method.
   */
  topics;
  /**
   *  The index within the block this log occurred at. This is generally
   *  not useful to developers, but can be used with the various roots
   *  to proof inclusion within a block.
   */
  index;
  /**
   *  The index within the transaction of this log.
   */
  transactionIndex;
  /**
   *  @_ignore:
   */
  constructor(log, provider) {
    this.provider = provider;
    const topics = Object.freeze(log.topics.slice());
    defineProperties(this, {
      transactionHash: log.transactionHash,
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      removed: log.removed,
      address: log.address,
      data: log.data,
      topics,
      index: log.index,
      transactionIndex: log.transactionIndex
    });
  }
  /**
   *  Returns a JSON-compatible object.
   */
  toJSON() {
    const { address, blockHash, blockNumber, data, index, removed, topics, transactionHash, transactionIndex } = this;
    return {
      _type: "log",
      address,
      blockHash,
      blockNumber,
      data,
      index,
      removed,
      topics,
      transactionHash,
      transactionIndex
    };
  }
  /**
   *  Returns the block that this log occurred in.
   */
  async getBlock() {
    const block = await this.provider.getBlock(this.blockHash);
    assert(!!block, "failed to find transaction", "UNKNOWN_ERROR", {});
    return block;
  }
  /**
   *  Returns the transaction that this log occurred in.
   */
  async getTransaction() {
    const tx = await this.provider.getTransaction(this.transactionHash);
    assert(!!tx, "failed to find transaction", "UNKNOWN_ERROR", {});
    return tx;
  }
  /**
   *  Returns the transaction receipt fot the transaction that this
   *  log occurred in.
   */
  async getTransactionReceipt() {
    const receipt = await this.provider.getTransactionReceipt(this.transactionHash);
    assert(!!receipt, "failed to find transaction receipt", "UNKNOWN_ERROR", {});
    return receipt;
  }
  /**
   *  @_ignore:
   */
  removedEvent() {
    return createRemovedLogFilter(this);
  }
};
var TransactionReceipt = class {
  /**
   *  The provider connected to the log used to fetch additional details
   *  if necessary.
   */
  provider;
  /**
   *  The address the transaction was sent to.
   */
  to;
  /**
   *  The sender of the transaction.
   */
  from;
  /**
   *  The address of the contract if the transaction was directly
   *  responsible for deploying one.
   *
   *  This is non-null **only** if the ``to`` is empty and the ``data``
   *  was successfully executed as initcode.
   */
  contractAddress;
  /**
   *  The transaction hash.
   */
  hash;
  /**
   *  The index of this transaction within the block transactions.
   */
  index;
  /**
   *  The block hash of the [[Block]] this transaction was included in.
   */
  blockHash;
  /**
   *  The block number of the [[Block]] this transaction was included in.
   */
  blockNumber;
  /**
   *  The bloom filter bytes that represent all logs that occurred within
   *  this transaction. This is generally not useful for most developers,
   *  but can be used to validate the included logs.
   */
  logsBloom;
  /**
   *  The actual amount of gas used by this transaction.
   *
   *  When creating a transaction, the amount of gas that will be used can
   *  only be approximated, but the sender must pay the gas fee for the
   *  entire gas limit. After the transaction, the difference is refunded.
   */
  gasUsed;
  /**
   *  The gas used for BLObs. See [[link-eip-4844]].
   */
  blobGasUsed;
  /**
   *  The amount of gas used by all transactions within the block for this
   *  and all transactions with a lower ``index``.
   *
   *  This is generally not useful for developers but can be used to
   *  validate certain aspects of execution.
   */
  cumulativeGasUsed;
  /**
   *  The actual gas price used during execution.
   *
   *  Due to the complexity of [[link-eip-1559]] this value can only
   *  be caluclated after the transaction has been mined, snce the base
   *  fee is protocol-enforced.
   */
  gasPrice;
  /**
   *  The price paid per BLOB in gas. See [[link-eip-4844]].
   */
  blobGasPrice;
  /**
   *  The [[link-eip-2718]] transaction type.
   */
  type;
  //readonly byzantium!: boolean;
  /**
   *  The status of this transaction, indicating success (i.e. ``1``) or
   *  a revert (i.e. ``0``).
   *
   *  This is available in post-byzantium blocks, but some backends may
   *  backfill this value.
   */
  status;
  /**
   *  The root hash of this transaction.
   *
   *  This is no present and was only included in pre-byzantium blocks, but
   *  could be used to validate certain parts of the receipt.
   */
  root;
  #logs;
  /**
   *  @_ignore:
   */
  constructor(tx, provider) {
    this.#logs = Object.freeze(tx.logs.map((log) => {
      return new Log(log, provider);
    }));
    let gasPrice = BN_09;
    if (tx.effectiveGasPrice != null) {
      gasPrice = tx.effectiveGasPrice;
    } else if (tx.gasPrice != null) {
      gasPrice = tx.gasPrice;
    }
    defineProperties(this, {
      provider,
      to: tx.to,
      from: tx.from,
      contractAddress: tx.contractAddress,
      hash: tx.hash,
      index: tx.index,
      blockHash: tx.blockHash,
      blockNumber: tx.blockNumber,
      logsBloom: tx.logsBloom,
      gasUsed: tx.gasUsed,
      cumulativeGasUsed: tx.cumulativeGasUsed,
      blobGasUsed: tx.blobGasUsed,
      gasPrice,
      blobGasPrice: tx.blobGasPrice,
      type: tx.type,
      //byzantium: tx.byzantium,
      status: tx.status,
      root: tx.root
    });
  }
  /**
   *  The logs for this transaction.
   */
  get logs() {
    return this.#logs;
  }
  /**
   *  Returns a JSON-compatible representation.
   */
  toJSON() {
    const {
      to,
      from,
      contractAddress,
      hash: hash2,
      index,
      blockHash,
      blockNumber,
      logsBloom,
      logs,
      //byzantium, 
      status,
      root
    } = this;
    return {
      _type: "TransactionReceipt",
      blockHash,
      blockNumber,
      //byzantium, 
      contractAddress,
      cumulativeGasUsed: toJson(this.cumulativeGasUsed),
      from,
      gasPrice: toJson(this.gasPrice),
      blobGasUsed: toJson(this.blobGasUsed),
      blobGasPrice: toJson(this.blobGasPrice),
      gasUsed: toJson(this.gasUsed),
      hash: hash2,
      index,
      logs,
      logsBloom,
      root,
      status,
      to
    };
  }
  /**
   *  @_ignore:
   */
  get length() {
    return this.logs.length;
  }
  [Symbol.iterator]() {
    let index = 0;
    return {
      next: () => {
        if (index < this.length) {
          return { value: this.logs[index++], done: false };
        }
        return { value: void 0, done: true };
      }
    };
  }
  /**
   *  The total fee for this transaction, in wei.
   */
  get fee() {
    return this.gasUsed * this.gasPrice;
  }
  /**
   *  Resolves to the block this transaction occurred in.
   */
  async getBlock() {
    const block = await this.provider.getBlock(this.blockHash);
    if (block == null) {
      throw new Error("TODO");
    }
    return block;
  }
  /**
   *  Resolves to the transaction this transaction occurred in.
   */
  async getTransaction() {
    const tx = await this.provider.getTransaction(this.hash);
    if (tx == null) {
      throw new Error("TODO");
    }
    return tx;
  }
  /**
   *  Resolves to the return value of the execution of this transaction.
   *
   *  Support for this feature is limited, as it requires an archive node
   *  with the ``debug_`` or ``trace_`` API enabled.
   */
  async getResult() {
    return await this.provider.getTransactionResult(this.hash);
  }
  /**
   *  Resolves to the number of confirmations this transaction has.
   */
  async confirmations() {
    return await this.provider.getBlockNumber() - this.blockNumber + 1;
  }
  /**
   *  @_ignore:
   */
  removedEvent() {
    return createRemovedTransactionFilter(this);
  }
  /**
   *  @_ignore:
   */
  reorderedEvent(other) {
    assert(!other || other.isMined(), "unmined 'other' transction cannot be orphaned", "UNSUPPORTED_OPERATION", { operation: "reorderedEvent(other)" });
    return createReorderedTransactionFilter(this, other);
  }
};
var TransactionResponse = class _TransactionResponse {
  /**
   *  The provider this is connected to, which will influence how its
   *  methods will resolve its async inspection methods.
   */
  provider;
  /**
   *  The block number of the block that this transaction was included in.
   *
   *  This is ``null`` for pending transactions.
   */
  blockNumber;
  /**
   *  The blockHash of the block that this transaction was included in.
   *
   *  This is ``null`` for pending transactions.
   */
  blockHash;
  /**
   *  The index within the block that this transaction resides at.
   */
  index;
  /**
   *  The transaction hash.
   */
  hash;
  /**
   *  The [[link-eip-2718]] transaction envelope type. This is
   *  ``0`` for legacy transactions types.
   */
  type;
  /**
   *  The receiver of this transaction.
   *
   *  If ``null``, then the transaction is an initcode transaction.
   *  This means the result of executing the [[data]] will be deployed
   *  as a new contract on chain (assuming it does not revert) and the
   *  address may be computed using [[getCreateAddress]].
   */
  to;
  /**
   *  The sender of this transaction. It is implicitly computed
   *  from the transaction pre-image hash (as the digest) and the
   *  [[signature]] using ecrecover.
   */
  from;
  /**
   *  The nonce, which is used to prevent replay attacks and offer
   *  a method to ensure transactions from a given sender are explicitly
   *  ordered.
   *
   *  When sending a transaction, this must be equal to the number of
   *  transactions ever sent by [[from]].
   */
  nonce;
  /**
   *  The maximum units of gas this transaction can consume. If execution
   *  exceeds this, the entries transaction is reverted and the sender
   *  is charged for the full amount, despite not state changes being made.
   */
  gasLimit;
  /**
   *  The gas price can have various values, depending on the network.
   *
   *  In modern networks, for transactions that are included this is
   *  the //effective gas price// (the fee per gas that was actually
   *  charged), while for transactions that have not been included yet
   *  is the [[maxFeePerGas]].
   *
   *  For legacy transactions, or transactions on legacy networks, this
   *  is the fee that will be charged per unit of gas the transaction
   *  consumes.
   */
  gasPrice;
  /**
   *  The maximum priority fee (per unit of gas) to allow a
   *  validator to charge the sender. This is inclusive of the
   *  [[maxFeeFeePerGas]].
   */
  maxPriorityFeePerGas;
  /**
   *  The maximum fee (per unit of gas) to allow this transaction
   *  to charge the sender.
   */
  maxFeePerGas;
  /**
   *  The [[link-eip-4844]] max fee per BLOb gas.
   */
  maxFeePerBlobGas;
  /**
   *  The data.
   */
  data;
  /**
   *  The value, in wei. Use [[formatEther]] to format this value
   *  as ether.
   */
  value;
  /**
   *  The chain ID.
   */
  chainId;
  /**
   *  The signature.
   */
  signature;
  /**
   *  The [[link-eip-2930]] access list for transaction types that
   *  support it, otherwise ``null``.
   */
  accessList;
  /**
   *  The [[link-eip-4844]] BLOb versioned hashes.
   */
  blobVersionedHashes;
  /**
   *  The [[link-eip-7702]] authorizations (if any).
   */
  authorizationList;
  #startBlock;
  /**
   *  @_ignore:
   */
  constructor(tx, provider) {
    this.provider = provider;
    this.blockNumber = tx.blockNumber != null ? tx.blockNumber : null;
    this.blockHash = tx.blockHash != null ? tx.blockHash : null;
    this.hash = tx.hash;
    this.index = tx.index;
    this.type = tx.type;
    this.from = tx.from;
    this.to = tx.to || null;
    this.gasLimit = tx.gasLimit;
    this.nonce = tx.nonce;
    this.data = tx.data;
    this.value = tx.value;
    this.gasPrice = tx.gasPrice;
    this.maxPriorityFeePerGas = tx.maxPriorityFeePerGas != null ? tx.maxPriorityFeePerGas : null;
    this.maxFeePerGas = tx.maxFeePerGas != null ? tx.maxFeePerGas : null;
    this.maxFeePerBlobGas = tx.maxFeePerBlobGas != null ? tx.maxFeePerBlobGas : null;
    this.chainId = tx.chainId;
    this.signature = tx.signature;
    this.accessList = tx.accessList != null ? tx.accessList : null;
    this.blobVersionedHashes = tx.blobVersionedHashes != null ? tx.blobVersionedHashes : null;
    this.authorizationList = tx.authorizationList != null ? tx.authorizationList : null;
    this.#startBlock = -1;
  }
  /**
   *  Returns a JSON-compatible representation of this transaction.
   */
  toJSON() {
    const { blockNumber, blockHash, index, hash: hash2, type, to, from, nonce, data, signature, accessList, blobVersionedHashes } = this;
    return {
      _type: "TransactionResponse",
      accessList,
      blockNumber,
      blockHash,
      blobVersionedHashes,
      chainId: toJson(this.chainId),
      data,
      from,
      gasLimit: toJson(this.gasLimit),
      gasPrice: toJson(this.gasPrice),
      hash: hash2,
      maxFeePerGas: toJson(this.maxFeePerGas),
      maxPriorityFeePerGas: toJson(this.maxPriorityFeePerGas),
      maxFeePerBlobGas: toJson(this.maxFeePerBlobGas),
      nonce,
      signature,
      to,
      index,
      type,
      value: toJson(this.value)
    };
  }
  /**
   *  Resolves to the Block that this transaction was included in.
   *
   *  This will return null if the transaction has not been included yet.
   */
  async getBlock() {
    let blockNumber = this.blockNumber;
    if (blockNumber == null) {
      const tx = await this.getTransaction();
      if (tx) {
        blockNumber = tx.blockNumber;
      }
    }
    if (blockNumber == null) {
      return null;
    }
    const block = this.provider.getBlock(blockNumber);
    if (block == null) {
      throw new Error("TODO");
    }
    return block;
  }
  /**
   *  Resolves to this transaction being re-requested from the
   *  provider. This can be used if you have an unmined transaction
   *  and wish to get an up-to-date populated instance.
   */
  async getTransaction() {
    return this.provider.getTransaction(this.hash);
  }
  /**
   *  Resolve to the number of confirmations this transaction has.
   */
  async confirmations() {
    if (this.blockNumber == null) {
      const { tx, blockNumber: blockNumber2 } = await resolveProperties({
        tx: this.getTransaction(),
        blockNumber: this.provider.getBlockNumber()
      });
      if (tx == null || tx.blockNumber == null) {
        return 0;
      }
      return blockNumber2 - tx.blockNumber + 1;
    }
    const blockNumber = await this.provider.getBlockNumber();
    return blockNumber - this.blockNumber + 1;
  }
  /**
   *  Resolves once this transaction has been mined and has
   *  %%confirms%% blocks including it (default: ``1``) with an
   *  optional %%timeout%%.
   *
   *  This can resolve to ``null`` only if %%confirms%% is ``0``
   *  and the transaction has not been mined, otherwise this will
   *  wait until enough confirmations have completed.
   */
  async wait(_confirms, _timeout) {
    const confirms = _confirms == null ? 1 : _confirms;
    const timeout = _timeout == null ? 0 : _timeout;
    let startBlock = this.#startBlock;
    let nextScan = -1;
    let stopScanning = startBlock === -1 ? true : false;
    const checkReplacement = async () => {
      if (stopScanning) {
        return null;
      }
      const { blockNumber, nonce } = await resolveProperties({
        blockNumber: this.provider.getBlockNumber(),
        nonce: this.provider.getTransactionCount(this.from)
      });
      if (nonce < this.nonce) {
        startBlock = blockNumber;
        return;
      }
      if (stopScanning) {
        return null;
      }
      const mined = await this.getTransaction();
      if (mined && mined.blockNumber != null) {
        return;
      }
      if (nextScan === -1) {
        nextScan = startBlock - 3;
        if (nextScan < this.#startBlock) {
          nextScan = this.#startBlock;
        }
      }
      while (nextScan <= blockNumber) {
        if (stopScanning) {
          return null;
        }
        const block = await this.provider.getBlock(nextScan, true);
        if (block == null) {
          return;
        }
        for (const hash2 of block) {
          if (hash2 === this.hash) {
            return;
          }
        }
        for (let i = 0; i < block.length; i++) {
          const tx = await block.getTransaction(i);
          if (tx.from === this.from && tx.nonce === this.nonce) {
            if (stopScanning) {
              return null;
            }
            const receipt2 = await this.provider.getTransactionReceipt(tx.hash);
            if (receipt2 == null) {
              return;
            }
            if (blockNumber - receipt2.blockNumber + 1 < confirms) {
              return;
            }
            let reason = "replaced";
            if (tx.data === this.data && tx.to === this.to && tx.value === this.value) {
              reason = "repriced";
            } else if (tx.data === "0x" && tx.from === tx.to && tx.value === BN_09) {
              reason = "cancelled";
            }
            assert(false, "transaction was replaced", "TRANSACTION_REPLACED", {
              cancelled: reason === "replaced" || reason === "cancelled",
              reason,
              replacement: tx.replaceableTransaction(startBlock),
              hash: tx.hash,
              receipt: receipt2
            });
          }
        }
        nextScan++;
      }
      return;
    };
    const checkReceipt = (receipt2) => {
      if (receipt2 == null || receipt2.status !== 0) {
        return receipt2;
      }
      assert(false, "transaction execution reverted", "CALL_EXCEPTION", {
        action: "sendTransaction",
        data: null,
        reason: null,
        invocation: null,
        revert: null,
        transaction: {
          to: receipt2.to,
          from: receipt2.from,
          data: ""
          // @TODO: in v7, split out sendTransaction properties
        },
        receipt: receipt2
      });
    };
    const receipt = await this.provider.getTransactionReceipt(this.hash);
    if (confirms === 0) {
      return checkReceipt(receipt);
    }
    if (receipt) {
      if (confirms === 1 || await receipt.confirmations() >= confirms) {
        return checkReceipt(receipt);
      }
    } else {
      await checkReplacement();
      if (confirms === 0) {
        return null;
      }
    }
    const waiter = new Promise((resolve, reject) => {
      const cancellers = [];
      const cancel = () => {
        cancellers.forEach((c) => c());
      };
      cancellers.push(() => {
        stopScanning = true;
      });
      if (timeout > 0) {
        const timer = setTimeout(() => {
          cancel();
          reject(makeError("wait for transaction timeout", "TIMEOUT"));
        }, timeout);
        cancellers.push(() => {
          clearTimeout(timer);
        });
      }
      const txListener = async (receipt2) => {
        if (await receipt2.confirmations() >= confirms) {
          cancel();
          try {
            resolve(checkReceipt(receipt2));
          } catch (error) {
            reject(error);
          }
        }
      };
      cancellers.push(() => {
        this.provider.off(this.hash, txListener);
      });
      this.provider.on(this.hash, txListener);
      if (startBlock >= 0) {
        const replaceListener = async () => {
          try {
            await checkReplacement();
          } catch (error) {
            if (isError(error, "TRANSACTION_REPLACED")) {
              cancel();
              reject(error);
              return;
            }
          }
          if (!stopScanning) {
            this.provider.once("block", replaceListener);
          }
        };
        cancellers.push(() => {
          this.provider.off("block", replaceListener);
        });
        this.provider.once("block", replaceListener);
      }
    });
    return await waiter;
  }
  /**
   *  Returns ``true`` if this transaction has been included.
   *
   *  This is effective only as of the time the TransactionResponse
   *  was instantiated. To get up-to-date information, use
   *  [[getTransaction]].
   *
   *  This provides a Type Guard that this transaction will have
   *  non-null property values for properties that are null for
   *  unmined transactions.
   */
  isMined() {
    return this.blockHash != null;
  }
  /**
   *  Returns true if the transaction is a legacy (i.e. ``type == 0``)
   *  transaction.
   *
   *  This provides a Type Guard that this transaction will have
   *  the ``null``-ness for hardfork-specific properties set correctly.
   */
  isLegacy() {
    return this.type === 0;
  }
  /**
   *  Returns true if the transaction is a Berlin (i.e. ``type == 1``)
   *  transaction. See [[link-eip-2070]].
   *
   *  This provides a Type Guard that this transaction will have
   *  the ``null``-ness for hardfork-specific properties set correctly.
   */
  isBerlin() {
    return this.type === 1;
  }
  /**
   *  Returns true if the transaction is a London (i.e. ``type == 2``)
   *  transaction. See [[link-eip-1559]].
   *
   *  This provides a Type Guard that this transaction will have
   *  the ``null``-ness for hardfork-specific properties set correctly.
   */
  isLondon() {
    return this.type === 2;
  }
  /**
   *  Returns true if hte transaction is a Cancun (i.e. ``type == 3``)
   *  transaction. See [[link-eip-4844]].
   */
  isCancun() {
    return this.type === 3;
  }
  /**
   *  Returns a filter which can be used to listen for orphan events
   *  that evict this transaction.
   */
  removedEvent() {
    assert(this.isMined(), "unmined transaction canot be orphaned", "UNSUPPORTED_OPERATION", { operation: "removeEvent()" });
    return createRemovedTransactionFilter(this);
  }
  /**
   *  Returns a filter which can be used to listen for orphan events
   *  that re-order this event against %%other%%.
   */
  reorderedEvent(other) {
    assert(this.isMined(), "unmined transaction canot be orphaned", "UNSUPPORTED_OPERATION", { operation: "removeEvent()" });
    assert(!other || other.isMined(), "unmined 'other' transaction canot be orphaned", "UNSUPPORTED_OPERATION", { operation: "removeEvent()" });
    return createReorderedTransactionFilter(this, other);
  }
  /**
   *  Returns a new TransactionResponse instance which has the ability to
   *  detect (and throw an error) if the transaction is replaced, which
   *  will begin scanning at %%startBlock%%.
   *
   *  This should generally not be used by developers and is intended
   *  primarily for internal use. Setting an incorrect %%startBlock%% can
   *  have devastating performance consequences if used incorrectly.
   */
  replaceableTransaction(startBlock) {
    assertArgument(Number.isInteger(startBlock) && startBlock >= 0, "invalid startBlock", "startBlock", startBlock);
    const tx = new _TransactionResponse(this, this.provider);
    tx.#startBlock = startBlock;
    return tx;
  }
};
function createOrphanedBlockFilter(block) {
  return { orphan: "drop-block", hash: block.hash, number: block.number };
}
function createReorderedTransactionFilter(tx, other) {
  return { orphan: "reorder-transaction", tx, other };
}
function createRemovedTransactionFilter(tx) {
  return { orphan: "drop-transaction", tx };
}
function createRemovedLogFilter(log) {
  return { orphan: "drop-log", log: {
    transactionHash: log.transactionHash,
    blockHash: log.blockHash,
    blockNumber: log.blockNumber,
    address: log.address,
    data: log.data,
    topics: Object.freeze(log.topics.slice()),
    index: log.index
  } };
}

// node_modules/ethers/lib.esm/contract/wrappers.js
var EventLog = class extends Log {
  /**
   *  The Contract Interface.
   */
  interface;
  /**
   *  The matching event.
   */
  fragment;
  /**
   *  The parsed arguments passed to the event by ``emit``.
   */
  args;
  /**
   * @_ignore:
   */
  constructor(log, iface, fragment) {
    super(log, log.provider);
    const args = iface.decodeEventLog(fragment, log.data, log.topics);
    defineProperties(this, { args, fragment, interface: iface });
  }
  /**
   *  The name of the event.
   */
  get eventName() {
    return this.fragment.name;
  }
  /**
   *  The signature of the event.
   */
  get eventSignature() {
    return this.fragment.format();
  }
};
var UndecodedEventLog = class extends Log {
  /**
   *  The error encounted when trying to decode the log.
   */
  error;
  /**
   * @_ignore:
   */
  constructor(log, error) {
    super(log, log.provider);
    defineProperties(this, { error });
  }
};
var ContractTransactionReceipt = class extends TransactionReceipt {
  #iface;
  /**
   *  @_ignore:
   */
  constructor(iface, provider, tx) {
    super(tx, provider);
    this.#iface = iface;
  }
  /**
   *  The parsed logs for any [[Log]] which has a matching event in the
   *  Contract ABI.
   */
  get logs() {
    return super.logs.map((log) => {
      const fragment = log.topics.length ? this.#iface.getEvent(log.topics[0]) : null;
      if (fragment) {
        try {
          return new EventLog(log, this.#iface, fragment);
        } catch (error) {
          return new UndecodedEventLog(log, error);
        }
      }
      return log;
    });
  }
};
var ContractTransactionResponse = class extends TransactionResponse {
  #iface;
  /**
   *  @_ignore:
   */
  constructor(iface, provider, tx) {
    super(tx, provider);
    this.#iface = iface;
  }
  /**
   *  Resolves once this transaction has been mined and has
   *  %%confirms%% blocks including it (default: ``1``) with an
   *  optional %%timeout%%.
   *
   *  This can resolve to ``null`` only if %%confirms%% is ``0``
   *  and the transaction has not been mined, otherwise this will
   *  wait until enough confirmations have completed.
   */
  async wait(confirms, timeout) {
    const receipt = await super.wait(confirms, timeout);
    if (receipt == null) {
      return null;
    }
    return new ContractTransactionReceipt(this.#iface, this.provider, receipt);
  }
};
var ContractUnknownEventPayload = class extends EventPayload {
  /**
   *  The log with no matching events.
   */
  log;
  /**
   *  @_event:
   */
  constructor(contract, listener, filter, log) {
    super(contract, listener, filter);
    defineProperties(this, { log });
  }
  /**
   *  Resolves to the block the event occured in.
   */
  async getBlock() {
    return await this.log.getBlock();
  }
  /**
   *  Resolves to the transaction the event occured in.
   */
  async getTransaction() {
    return await this.log.getTransaction();
  }
  /**
   *  Resolves to the transaction receipt the event occured in.
   */
  async getTransactionReceipt() {
    return await this.log.getTransactionReceipt();
  }
};
var ContractEventPayload = class extends ContractUnknownEventPayload {
  /**
   *  @_ignore:
   */
  constructor(contract, listener, filter, fragment, _log) {
    super(contract, listener, filter, new EventLog(_log, contract.interface, fragment));
    const args = contract.interface.decodeEventLog(fragment, this.log.data, this.log.topics);
    defineProperties(this, { args, fragment });
  }
  /**
   *  The event name.
   */
  get eventName() {
    return this.fragment.name;
  }
  /**
   *  The event signature.
   */
  get eventSignature() {
    return this.fragment.format();
  }
};

// node_modules/ethers/lib.esm/contract/contract.js
var BN_010 = BigInt(0);
function canCall(value) {
  return value && typeof value.call === "function";
}
function canEstimate(value) {
  return value && typeof value.estimateGas === "function";
}
function canResolve(value) {
  return value && typeof value.resolveName === "function";
}
function canSend(value) {
  return value && typeof value.sendTransaction === "function";
}
function getResolver(value) {
  if (value != null) {
    if (canResolve(value)) {
      return value;
    }
    if (value.provider) {
      return value.provider;
    }
  }
  return void 0;
}
var PreparedTopicFilter = class {
  #filter;
  fragment;
  constructor(contract, fragment, args) {
    defineProperties(this, { fragment });
    if (fragment.inputs.length < args.length) {
      throw new Error("too many arguments");
    }
    const runner = getRunner(contract.runner, "resolveName");
    const resolver = canResolve(runner) ? runner : null;
    this.#filter = async function() {
      const resolvedArgs = await Promise.all(fragment.inputs.map((param, index) => {
        const arg = args[index];
        if (arg == null) {
          return null;
        }
        return param.walkAsync(args[index], (type, value) => {
          if (type === "address") {
            if (Array.isArray(value)) {
              return Promise.all(value.map((v) => resolveAddress(v, resolver)));
            }
            return resolveAddress(value, resolver);
          }
          return value;
        });
      }));
      return contract.interface.encodeFilterTopics(fragment, resolvedArgs);
    }();
  }
  getTopicFilter() {
    return this.#filter;
  }
};
function getRunner(value, feature) {
  if (value == null) {
    return null;
  }
  if (typeof value[feature] === "function") {
    return value;
  }
  if (value.provider && typeof value.provider[feature] === "function") {
    return value.provider;
  }
  return null;
}
function getProvider(value) {
  if (value == null) {
    return null;
  }
  return value.provider || null;
}
async function copyOverrides(arg, allowed) {
  const _overrides = Typed.dereference(arg, "overrides");
  assertArgument(typeof _overrides === "object", "invalid overrides parameter", "overrides", arg);
  const overrides = copyRequest(_overrides);
  assertArgument(overrides.to == null || (allowed || []).indexOf("to") >= 0, "cannot override to", "overrides.to", overrides.to);
  assertArgument(overrides.data == null || (allowed || []).indexOf("data") >= 0, "cannot override data", "overrides.data", overrides.data);
  if (overrides.from) {
    overrides.from = overrides.from;
  }
  return overrides;
}
async function resolveArgs(_runner, inputs, args) {
  const runner = getRunner(_runner, "resolveName");
  const resolver = canResolve(runner) ? runner : null;
  return await Promise.all(inputs.map((param, index) => {
    return param.walkAsync(args[index], (type, value) => {
      value = Typed.dereference(value, type);
      if (type === "address") {
        return resolveAddress(value, resolver);
      }
      return value;
    });
  }));
}
function buildWrappedFallback(contract) {
  const populateTransaction = async function(overrides) {
    const tx = await copyOverrides(overrides, ["data"]);
    tx.to = await contract.getAddress();
    if (tx.from) {
      tx.from = await resolveAddress(tx.from, getResolver(contract.runner));
    }
    const iface = contract.interface;
    const noValue = getBigInt(tx.value || BN_010, "overrides.value") === BN_010;
    const noData = (tx.data || "0x") === "0x";
    if (iface.fallback && !iface.fallback.payable && iface.receive && !noData && !noValue) {
      assertArgument(false, "cannot send data to receive or send value to non-payable fallback", "overrides", overrides);
    }
    assertArgument(iface.fallback || noData, "cannot send data to receive-only contract", "overrides.data", tx.data);
    const payable = iface.receive || iface.fallback && iface.fallback.payable;
    assertArgument(payable || noValue, "cannot send value to non-payable fallback", "overrides.value", tx.value);
    assertArgument(iface.fallback || noData, "cannot send data to receive-only contract", "overrides.data", tx.data);
    return tx;
  };
  const staticCall = async function(overrides) {
    const runner = getRunner(contract.runner, "call");
    assert(canCall(runner), "contract runner does not support calling", "UNSUPPORTED_OPERATION", { operation: "call" });
    const tx = await populateTransaction(overrides);
    try {
      return await runner.call(tx);
    } catch (error) {
      if (isCallException(error) && error.data) {
        throw contract.interface.makeError(error.data, tx);
      }
      throw error;
    }
  };
  const send2 = async function(overrides) {
    const runner = contract.runner;
    assert(canSend(runner), "contract runner does not support sending transactions", "UNSUPPORTED_OPERATION", { operation: "sendTransaction" });
    const tx = await runner.sendTransaction(await populateTransaction(overrides));
    const provider = getProvider(contract.runner);
    return new ContractTransactionResponse(contract.interface, provider, tx);
  };
  const estimateGas = async function(overrides) {
    const runner = getRunner(contract.runner, "estimateGas");
    assert(canEstimate(runner), "contract runner does not support gas estimation", "UNSUPPORTED_OPERATION", { operation: "estimateGas" });
    return await runner.estimateGas(await populateTransaction(overrides));
  };
  const method = async (overrides) => {
    return await send2(overrides);
  };
  defineProperties(method, {
    _contract: contract,
    estimateGas,
    populateTransaction,
    send: send2,
    staticCall
  });
  return method;
}
function buildWrappedMethod(contract, key) {
  const getFragment = function(...args) {
    const fragment = contract.interface.getFunction(key, args);
    assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
      operation: "fragment",
      info: { key, args }
    });
    return fragment;
  };
  const populateTransaction = async function(...args) {
    const fragment = getFragment(...args);
    let overrides = {};
    if (fragment.inputs.length + 1 === args.length) {
      overrides = await copyOverrides(args.pop());
      if (overrides.from) {
        overrides.from = await resolveAddress(overrides.from, getResolver(contract.runner));
      }
    }
    if (fragment.inputs.length !== args.length) {
      throw new Error("internal error: fragment inputs doesn't match arguments; should not happen");
    }
    const resolvedArgs = await resolveArgs(contract.runner, fragment.inputs, args);
    return Object.assign({}, overrides, await resolveProperties({
      to: contract.getAddress(),
      data: contract.interface.encodeFunctionData(fragment, resolvedArgs)
    }));
  };
  const staticCall = async function(...args) {
    const result2 = await staticCallResult(...args);
    if (result2.length === 1) {
      return result2[0];
    }
    return result2;
  };
  const send2 = async function(...args) {
    const runner = contract.runner;
    assert(canSend(runner), "contract runner does not support sending transactions", "UNSUPPORTED_OPERATION", { operation: "sendTransaction" });
    const tx = await runner.sendTransaction(await populateTransaction(...args));
    const provider = getProvider(contract.runner);
    return new ContractTransactionResponse(contract.interface, provider, tx);
  };
  const estimateGas = async function(...args) {
    const runner = getRunner(contract.runner, "estimateGas");
    assert(canEstimate(runner), "contract runner does not support gas estimation", "UNSUPPORTED_OPERATION", { operation: "estimateGas" });
    return await runner.estimateGas(await populateTransaction(...args));
  };
  const staticCallResult = async function(...args) {
    const runner = getRunner(contract.runner, "call");
    assert(canCall(runner), "contract runner does not support calling", "UNSUPPORTED_OPERATION", { operation: "call" });
    const tx = await populateTransaction(...args);
    let result2 = "0x";
    try {
      result2 = await runner.call(tx);
    } catch (error) {
      if (isCallException(error) && error.data) {
        throw contract.interface.makeError(error.data, tx);
      }
      throw error;
    }
    const fragment = getFragment(...args);
    return contract.interface.decodeFunctionResult(fragment, result2);
  };
  const method = async (...args) => {
    const fragment = getFragment(...args);
    if (fragment.constant) {
      return await staticCall(...args);
    }
    return await send2(...args);
  };
  defineProperties(method, {
    name: contract.interface.getFunctionName(key),
    _contract: contract,
    _key: key,
    getFragment,
    estimateGas,
    populateTransaction,
    send: send2,
    staticCall,
    staticCallResult
  });
  Object.defineProperty(method, "fragment", {
    configurable: false,
    enumerable: true,
    get: () => {
      const fragment = contract.interface.getFunction(key);
      assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
        operation: "fragment",
        info: { key }
      });
      return fragment;
    }
  });
  return method;
}
function buildWrappedEvent(contract, key) {
  const getFragment = function(...args) {
    const fragment = contract.interface.getEvent(key, args);
    assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
      operation: "fragment",
      info: { key, args }
    });
    return fragment;
  };
  const method = function(...args) {
    return new PreparedTopicFilter(contract, getFragment(...args), args);
  };
  defineProperties(method, {
    name: contract.interface.getEventName(key),
    _contract: contract,
    _key: key,
    getFragment
  });
  Object.defineProperty(method, "fragment", {
    configurable: false,
    enumerable: true,
    get: () => {
      const fragment = contract.interface.getEvent(key);
      assert(fragment, "no matching fragment", "UNSUPPORTED_OPERATION", {
        operation: "fragment",
        info: { key }
      });
      return fragment;
    }
  });
  return method;
}
var internal2 = Symbol.for("_ethersInternal_contract");
var internalValues = /* @__PURE__ */ new WeakMap();
function setInternal(contract, values) {
  internalValues.set(contract[internal2], values);
}
function getInternal(contract) {
  return internalValues.get(contract[internal2]);
}
function isDeferred(value) {
  return value && typeof value === "object" && "getTopicFilter" in value && typeof value.getTopicFilter === "function" && value.fragment;
}
async function getSubInfo(contract, event) {
  let topics;
  let fragment = null;
  if (Array.isArray(event)) {
    const topicHashify = function(name) {
      if (isHexString(name, 32)) {
        return name;
      }
      const fragment2 = contract.interface.getEvent(name);
      assertArgument(fragment2, "unknown fragment", "name", name);
      return fragment2.topicHash;
    };
    topics = event.map((e) => {
      if (e == null) {
        return null;
      }
      if (Array.isArray(e)) {
        return e.map(topicHashify);
      }
      return topicHashify(e);
    });
  } else if (event === "*") {
    topics = [null];
  } else if (typeof event === "string") {
    if (isHexString(event, 32)) {
      topics = [event];
    } else {
      fragment = contract.interface.getEvent(event);
      assertArgument(fragment, "unknown fragment", "event", event);
      topics = [fragment.topicHash];
    }
  } else if (isDeferred(event)) {
    topics = await event.getTopicFilter();
  } else if ("fragment" in event) {
    fragment = event.fragment;
    topics = [fragment.topicHash];
  } else {
    assertArgument(false, "unknown event name", "event", event);
  }
  topics = topics.map((t) => {
    if (t == null) {
      return null;
    }
    if (Array.isArray(t)) {
      const items = Array.from(new Set(t.map((t2) => t2.toLowerCase())).values());
      if (items.length === 1) {
        return items[0];
      }
      items.sort();
      return items;
    }
    return t.toLowerCase();
  });
  const tag = topics.map((t) => {
    if (t == null) {
      return "null";
    }
    if (Array.isArray(t)) {
      return t.join("|");
    }
    return t;
  }).join("&");
  return { fragment, tag, topics };
}
async function hasSub(contract, event) {
  const { subs } = getInternal(contract);
  return subs.get((await getSubInfo(contract, event)).tag) || null;
}
async function getSub(contract, operation, event) {
  const provider = getProvider(contract.runner);
  assert(provider, "contract runner does not support subscribing", "UNSUPPORTED_OPERATION", { operation });
  const { fragment, tag, topics } = await getSubInfo(contract, event);
  const { addr, subs } = getInternal(contract);
  let sub = subs.get(tag);
  if (!sub) {
    const address = addr ? addr : contract;
    const filter = { address, topics };
    const listener = (log) => {
      let foundFragment = fragment;
      if (foundFragment == null) {
        try {
          foundFragment = contract.interface.getEvent(log.topics[0]);
        } catch (error) {
        }
      }
      if (foundFragment) {
        const _foundFragment = foundFragment;
        const args = fragment ? contract.interface.decodeEventLog(fragment, log.data, log.topics) : [];
        emit(contract, event, args, (listener2) => {
          return new ContractEventPayload(contract, listener2, event, _foundFragment, log);
        });
      } else {
        emit(contract, event, [], (listener2) => {
          return new ContractUnknownEventPayload(contract, listener2, event, log);
        });
      }
    };
    let starting = [];
    const start = () => {
      if (starting.length) {
        return;
      }
      starting.push(provider.on(filter, listener));
    };
    const stop = async () => {
      if (starting.length == 0) {
        return;
      }
      let started = starting;
      starting = [];
      await Promise.all(started);
      provider.off(filter, listener);
    };
    sub = { tag, listeners: [], start, stop };
    subs.set(tag, sub);
  }
  return sub;
}
var lastEmit = Promise.resolve();
async function _emit(contract, event, args, payloadFunc) {
  await lastEmit;
  const sub = await hasSub(contract, event);
  if (!sub) {
    return false;
  }
  const count = sub.listeners.length;
  sub.listeners = sub.listeners.filter(({ listener, once }) => {
    const passArgs = Array.from(args);
    if (payloadFunc) {
      passArgs.push(payloadFunc(once ? null : listener));
    }
    try {
      listener.call(contract, ...passArgs);
    } catch (error) {
    }
    return !once;
  });
  if (sub.listeners.length === 0) {
    sub.stop();
    getInternal(contract).subs.delete(sub.tag);
  }
  return count > 0;
}
async function emit(contract, event, args, payloadFunc) {
  try {
    await lastEmit;
  } catch (error) {
  }
  const resultPromise = _emit(contract, event, args, payloadFunc);
  lastEmit = resultPromise;
  return await resultPromise;
}
var passProperties2 = ["then"];
var BaseContract = class _BaseContract {
  /**
   *  The target to connect to.
   *
   *  This can be an address, ENS name or any [[Addressable]], such as
   *  another contract. To get the resolved address, use the ``getAddress``
   *  method.
   */
  target;
  /**
   *  The contract Interface.
   */
  interface;
  /**
   *  The connected runner. This is generally a [[Provider]] or a
   *  [[Signer]], which dictates what operations are supported.
   *
   *  For example, a **Contract** connected to a [[Provider]] may
   *  only execute read-only operations.
   */
  runner;
  /**
   *  All the Events available on this contract.
   */
  filters;
  /**
   *  @_ignore:
   */
  [internal2];
  /**
   *  The fallback or receive function if any.
   */
  fallback;
  /**
   *  Creates a new contract connected to %%target%% with the %%abi%% and
   *  optionally connected to a %%runner%% to perform operations on behalf
   *  of.
   */
  constructor(target, abi, runner, _deployTx) {
    assertArgument(typeof target === "string" || isAddressable(target), "invalid value for Contract target", "target", target);
    if (runner == null) {
      runner = null;
    }
    const iface = Interface.from(abi);
    defineProperties(this, { target, runner, interface: iface });
    Object.defineProperty(this, internal2, { value: {} });
    let addrPromise;
    let addr = null;
    let deployTx = null;
    if (_deployTx) {
      const provider = getProvider(runner);
      deployTx = new ContractTransactionResponse(this.interface, provider, _deployTx);
    }
    let subs = /* @__PURE__ */ new Map();
    if (typeof target === "string") {
      if (isHexString(target)) {
        addr = target;
        addrPromise = Promise.resolve(target);
      } else {
        const resolver = getRunner(runner, "resolveName");
        if (!canResolve(resolver)) {
          throw makeError("contract runner does not support name resolution", "UNSUPPORTED_OPERATION", {
            operation: "resolveName"
          });
        }
        addrPromise = resolver.resolveName(target).then((addr2) => {
          if (addr2 == null) {
            throw makeError("an ENS name used for a contract target must be correctly configured", "UNCONFIGURED_NAME", {
              value: target
            });
          }
          getInternal(this).addr = addr2;
          return addr2;
        });
      }
    } else {
      addrPromise = target.getAddress().then((addr2) => {
        if (addr2 == null) {
          throw new Error("TODO");
        }
        getInternal(this).addr = addr2;
        return addr2;
      });
    }
    setInternal(this, { addrPromise, addr, deployTx, subs });
    const filters = new Proxy({}, {
      get: (target2, prop, receiver) => {
        if (typeof prop === "symbol" || passProperties2.indexOf(prop) >= 0) {
          return Reflect.get(target2, prop, receiver);
        }
        try {
          return this.getEvent(prop);
        } catch (error) {
          if (!isError(error, "INVALID_ARGUMENT") || error.argument !== "key") {
            throw error;
          }
        }
        return void 0;
      },
      has: (target2, prop) => {
        if (passProperties2.indexOf(prop) >= 0) {
          return Reflect.has(target2, prop);
        }
        return Reflect.has(target2, prop) || this.interface.hasEvent(String(prop));
      }
    });
    defineProperties(this, { filters });
    defineProperties(this, {
      fallback: iface.receive || iface.fallback ? buildWrappedFallback(this) : null
    });
    return new Proxy(this, {
      get: (target2, prop, receiver) => {
        if (typeof prop === "symbol" || prop in target2 || passProperties2.indexOf(prop) >= 0) {
          return Reflect.get(target2, prop, receiver);
        }
        try {
          return target2.getFunction(prop);
        } catch (error) {
          if (!isError(error, "INVALID_ARGUMENT") || error.argument !== "key") {
            throw error;
          }
        }
        return void 0;
      },
      has: (target2, prop) => {
        if (typeof prop === "symbol" || prop in target2 || passProperties2.indexOf(prop) >= 0) {
          return Reflect.has(target2, prop);
        }
        return target2.interface.hasFunction(prop);
      }
    });
  }
  /**
   *  Return a new Contract instance with the same target and ABI, but
   *  a different %%runner%%.
   */
  connect(runner) {
    return new _BaseContract(this.target, this.interface, runner);
  }
  /**
   *  Return a new Contract instance with the same ABI and runner, but
   *  a different %%target%%.
   */
  attach(target) {
    return new _BaseContract(target, this.interface, this.runner);
  }
  /**
   *  Return the resolved address of this Contract.
   */
  async getAddress() {
    return await getInternal(this).addrPromise;
  }
  /**
   *  Return the deployed bytecode or null if no bytecode is found.
   */
  async getDeployedCode() {
    const provider = getProvider(this.runner);
    assert(provider, "runner does not support .provider", "UNSUPPORTED_OPERATION", { operation: "getDeployedCode" });
    const code = await provider.getCode(await this.getAddress());
    if (code === "0x") {
      return null;
    }
    return code;
  }
  /**
   *  Resolve to this Contract once the bytecode has been deployed, or
   *  resolve immediately if already deployed.
   */
  async waitForDeployment() {
    const deployTx = this.deploymentTransaction();
    if (deployTx) {
      await deployTx.wait();
      return this;
    }
    const code = await this.getDeployedCode();
    if (code != null) {
      return this;
    }
    const provider = getProvider(this.runner);
    assert(provider != null, "contract runner does not support .provider", "UNSUPPORTED_OPERATION", { operation: "waitForDeployment" });
    return new Promise((resolve, reject) => {
      const checkCode = async () => {
        try {
          const code2 = await this.getDeployedCode();
          if (code2 != null) {
            return resolve(this);
          }
          provider.once("block", checkCode);
        } catch (error) {
          reject(error);
        }
      };
      checkCode();
    });
  }
  /**
   *  Return the transaction used to deploy this contract.
   *
   *  This is only available if this instance was returned from a
   *  [[ContractFactory]].
   */
  deploymentTransaction() {
    return getInternal(this).deployTx;
  }
  /**
   *  Return the function for a given name. This is useful when a contract
   *  method name conflicts with a JavaScript name such as ``prototype`` or
   *  when using a Contract programmatically.
   */
  getFunction(key) {
    if (typeof key !== "string") {
      key = key.format();
    }
    const func = buildWrappedMethod(this, key);
    return func;
  }
  /**
   *  Return the event for a given name. This is useful when a contract
   *  event name conflicts with a JavaScript name such as ``prototype`` or
   *  when using a Contract programmatically.
   */
  getEvent(key) {
    if (typeof key !== "string") {
      key = key.format();
    }
    return buildWrappedEvent(this, key);
  }
  /**
   *  @_ignore:
   */
  async queryTransaction(hash2) {
    throw new Error("@TODO");
  }
  /*
      // @TODO: this is a non-backwards compatible change, but will be added
      //        in v7 and in a potential SmartContract class in an upcoming
      //        v6 release
      async getTransactionReceipt(hash: string): Promise<null | ContractTransactionReceipt> {
          const provider = getProvider(this.runner);
          assert(provider, "contract runner does not have a provider",
              "UNSUPPORTED_OPERATION", { operation: "queryTransaction" });
  
          const receipt = await provider.getTransactionReceipt(hash);
          if (receipt == null) { return null; }
  
          return new ContractTransactionReceipt(this.interface, provider, receipt);
      }
      */
  /**
   *  Provide historic access to event data for %%event%% in the range
   *  %%fromBlock%% (default: ``0``) to %%toBlock%% (default: ``"latest"``)
   *  inclusive.
   */
  async queryFilter(event, fromBlock, toBlock) {
    if (fromBlock == null) {
      fromBlock = 0;
    }
    if (toBlock == null) {
      toBlock = "latest";
    }
    const { addr, addrPromise } = getInternal(this);
    const address = addr ? addr : await addrPromise;
    const { fragment, topics } = await getSubInfo(this, event);
    const filter = { address, topics, fromBlock, toBlock };
    const provider = getProvider(this.runner);
    assert(provider, "contract runner does not have a provider", "UNSUPPORTED_OPERATION", { operation: "queryFilter" });
    return (await provider.getLogs(filter)).map((log) => {
      let foundFragment = fragment;
      if (foundFragment == null) {
        try {
          foundFragment = this.interface.getEvent(log.topics[0]);
        } catch (error) {
        }
      }
      if (foundFragment) {
        try {
          return new EventLog(log, this.interface, foundFragment);
        } catch (error) {
          return new UndecodedEventLog(log, error);
        }
      }
      return new Log(log, provider);
    });
  }
  /**
   *  Add an event %%listener%% for the %%event%%.
   */
  async on(event, listener) {
    const sub = await getSub(this, "on", event);
    sub.listeners.push({ listener, once: false });
    sub.start();
    return this;
  }
  /**
   *  Add an event %%listener%% for the %%event%%, but remove the listener
   *  after it is fired once.
   */
  async once(event, listener) {
    const sub = await getSub(this, "once", event);
    sub.listeners.push({ listener, once: true });
    sub.start();
    return this;
  }
  /**
   *  Emit an %%event%% calling all listeners with %%args%%.
   *
   *  Resolves to ``true`` if any listeners were called.
   */
  async emit(event, ...args) {
    return await emit(this, event, args, null);
  }
  /**
   *  Resolves to the number of listeners of %%event%% or the total number
   *  of listeners if unspecified.
   */
  async listenerCount(event) {
    if (event) {
      const sub = await hasSub(this, event);
      if (!sub) {
        return 0;
      }
      return sub.listeners.length;
    }
    const { subs } = getInternal(this);
    let total = 0;
    for (const { listeners } of subs.values()) {
      total += listeners.length;
    }
    return total;
  }
  /**
   *  Resolves to the listeners subscribed to %%event%% or all listeners
   *  if unspecified.
   */
  async listeners(event) {
    if (event) {
      const sub = await hasSub(this, event);
      if (!sub) {
        return [];
      }
      return sub.listeners.map(({ listener }) => listener);
    }
    const { subs } = getInternal(this);
    let result2 = [];
    for (const { listeners } of subs.values()) {
      result2 = result2.concat(listeners.map(({ listener }) => listener));
    }
    return result2;
  }
  /**
   *  Remove the %%listener%% from the listeners for %%event%% or remove
   *  all listeners if unspecified.
   */
  async off(event, listener) {
    const sub = await hasSub(this, event);
    if (!sub) {
      return this;
    }
    if (listener) {
      const index = sub.listeners.map(({ listener: listener2 }) => listener2).indexOf(listener);
      if (index >= 0) {
        sub.listeners.splice(index, 1);
      }
    }
    if (listener == null || sub.listeners.length === 0) {
      sub.stop();
      getInternal(this).subs.delete(sub.tag);
    }
    return this;
  }
  /**
   *  Remove all the listeners for %%event%% or remove all listeners if
   *  unspecified.
   */
  async removeAllListeners(event) {
    if (event) {
      const sub = await hasSub(this, event);
      if (!sub) {
        return this;
      }
      sub.stop();
      getInternal(this).subs.delete(sub.tag);
    } else {
      const { subs } = getInternal(this);
      for (const { tag, stop } of subs.values()) {
        stop();
        subs.delete(tag);
      }
    }
    return this;
  }
  /**
   *  Alias for [on].
   */
  async addListener(event, listener) {
    return await this.on(event, listener);
  }
  /**
   *  Alias for [off].
   */
  async removeListener(event, listener) {
    return await this.off(event, listener);
  }
  /**
   *  Create a new Class for the %%abi%%.
   */
  static buildClass(abi) {
    class CustomContract extends _BaseContract {
      constructor(address, runner = null) {
        super(address, abi, runner);
      }
    }
    return CustomContract;
  }
  /**
   *  Create a new BaseContract with a specified Interface.
   */
  static from(target, abi, runner) {
    if (runner == null) {
      runner = null;
    }
    const contract = new this(target, abi, runner);
    return contract;
  }
};
function _ContractBase() {
  return BaseContract;
}
var Contract = class extends _ContractBase() {
};

// node_modules/ethers/lib.esm/providers/ens-resolver.js
var BN_60 = BigInt(60);
function getIpfsLink(link) {
  if (link.match(/^ipfs:\/\/ipfs\//i)) {
    link = link.substring(12);
  } else if (link.match(/^ipfs:\/\//i)) {
    link = link.substring(7);
  } else {
    assertArgument(false, "unsupported IPFS format", "link", link);
  }
  return `https://gateway.ipfs.io/ipfs/${link}`;
}
var MulticoinProviderPlugin = class {
  /**
   *  The name.
   */
  name;
  /**
   *  Creates a new **MulticoinProviderPluing** for %%name%%.
   */
  constructor(name) {
    defineProperties(this, { name });
  }
  connect(provider) {
    return this;
  }
  /**
   *  Returns ``true`` if %%coinType%% is supported by this plugin.
   */
  supportsCoinType(coinType) {
    return false;
  }
  /**
   *  Resolves to the encoded %%address%% for %%coinType%%.
   */
  async encodeAddress(coinType, address) {
    throw new Error("unsupported coin");
  }
  /**
   *  Resolves to the decoded %%data%% for %%coinType%%.
   */
  async decodeAddress(coinType, data) {
    throw new Error("unsupported coin");
  }
};
var matcherIpfs = new RegExp("^(ipfs)://(.*)$", "i");
var matchers = [
  new RegExp("^(https)://(.*)$", "i"),
  new RegExp("^(data):(.*)$", "i"),
  matcherIpfs,
  new RegExp("^eip155:[0-9]+/(erc[0-9]+):(.*)$", "i")
];
function isEvmCoinType(coinType) {
  return coinType === BN_60 || coinType >= 2147483648 && coinType <= 4294967295;
}
var EnsResolver = class _EnsResolver {
  /**
   *  The connected provider.
   */
  provider;
  /**
   *  The address of the resolver.
   */
  address;
  /**
   *  The name this resolver was resolved against.
   */
  name;
  // For EIP-2544 names, the ancestor that provided the resolver
  #supports2544;
  #resolver;
  constructor(provider, address, name, supportsWildcard) {
    defineProperties(this, { provider, address, name });
    this.#supports2544 = supportsWildcard != null ? Promise.resolve(supportsWildcard) : null;
    this.#resolver = new Contract(address, [
      "function supportsInterface(bytes4) view returns (bool)",
      "function resolve(bytes, bytes) view returns (bytes)",
      "function addr(bytes32) view returns (address)",
      "function addr(bytes32, uint) view returns (bytes)",
      "function text(bytes32, string) view returns (string)",
      "function contenthash(bytes32) view returns (bytes)",
      "function name(bytes32) view returns (string)"
    ], provider);
  }
  /**
   *  Resolves to true if the resolver supports wildcard resolution.
   */
  async supportsWildcard() {
    if (this.#supports2544 == null) {
      this.#supports2544 = (async () => {
        try {
          return await this.#resolver.supportsInterface("0x9061b923");
        } catch (error) {
          if (isError(error, "CALL_EXCEPTION")) {
            return false;
          }
          this.#supports2544 = null;
          throw error;
        }
      })();
    }
    return await this.#supports2544;
  }
  async #fetch(funcName, params) {
    params = (params || []).slice();
    const iface = this.#resolver.interface;
    params.unshift(namehash(this.name));
    let fragment = null;
    if (await this.supportsWildcard()) {
      fragment = iface.getFunction(funcName);
      assert(fragment, "missing fragment", "UNKNOWN_ERROR", {
        info: { funcName }
      });
      params = [
        dnsEncode(this.name, 255),
        iface.encodeFunctionData(fragment, params)
      ];
      funcName = "resolve(bytes,bytes)";
    }
    params.push({ enableCcipRead: true });
    try {
      const result2 = await this.#resolver[funcName](...params);
      if (fragment) {
        return iface.decodeFunctionResult(fragment, result2)[0];
      }
      return result2;
    } catch (error) {
      if (!isError(error, "CALL_EXCEPTION")) {
        throw error;
      }
    }
    return null;
  }
  /**
   *  Resolves to the address for %%coinType%% or null if the
   *  provided %%coinType%% has not been configured.
   */
  async getAddress(_coinType) {
    const coinType = _coinType == null ? BN_60 : getBigInt(_coinType);
    if (coinType === BN_60) {
      try {
        const result2 = await this.#fetch("addr(bytes32)");
        if (result2 == null || result2 === ZeroAddress) {
          return null;
        }
        return result2;
      } catch (error) {
        if (isError(error, "CALL_EXCEPTION")) {
          return null;
        }
        throw error;
      }
    }
    if (isEvmCoinType(coinType)) {
      const data2 = await this.#fetch("addr(bytes32,uint)", [coinType]);
      if (isHexString(data2, 20)) {
        return getAddress(data2);
      }
      return null;
    }
    if (coinType >= 0 && coinType < 2147483648) {
      let ethCoinType = coinType + BigInt(2147483648);
      const data2 = await this.#fetch("addr(bytes32,uint)", [ethCoinType]);
      if (isHexString(data2, 20)) {
        return getAddress(data2);
      }
    }
    let coinPlugin = null;
    for (const plugin of this.provider.plugins) {
      if (!(plugin instanceof MulticoinProviderPlugin)) {
        continue;
      }
      if (coinType <= 2147483648 && plugin.supportsCoinType(Number(coinType))) {
        coinPlugin = plugin;
        break;
      }
    }
    if (coinPlugin == null) {
      return null;
    }
    const data = await this.#fetch("addr(bytes32,uint)", [coinType]);
    if (data == null || data === "0x") {
      return null;
    }
    if (coinType < 2147483648) {
      const address = await coinPlugin.decodeAddress(Number(coinType), data);
      if (address != null) {
        return address;
      }
    }
    assert(false, `invalid coin data`, "UNSUPPORTED_OPERATION", {
      operation: `getAddress(${coinType})`,
      info: { coinType, data }
    });
  }
  /**
   *  Resolves to the EIP-634 text record for %%key%%, or ``null``
   *  if unconfigured.
   */
  async getText(key) {
    const data = await this.#fetch("text(bytes32,string)", [key]);
    if (data == null || data === "0x") {
      return null;
    }
    return data;
  }
  /**
   *  Rsolves to the content-hash or ``null`` if unconfigured.
   */
  async getContentHash() {
    const data = await this.#fetch("contenthash(bytes32)");
    if (data == null || data === "0x") {
      return null;
    }
    const ipfs = data.match(/^0x(e3010170|e5010172)(([0-9a-f][0-9a-f])([0-9a-f][0-9a-f])([0-9a-f]*))$/);
    if (ipfs) {
      const scheme = ipfs[1] === "e3010170" ? "ipfs" : "ipns";
      const length = parseInt(ipfs[4], 16);
      if (ipfs[5].length === length * 2) {
        return `${scheme}://${encodeBase58("0x" + ipfs[2])}`;
      }
    }
    const swarm = data.match(/^0xe40101fa011b20([0-9a-f]*)$/);
    if (swarm && swarm[1].length === 64) {
      return `bzz://${swarm[1]}`;
    }
    assert(false, `invalid or unsupported content hash data`, "UNSUPPORTED_OPERATION", {
      operation: "getContentHash()",
      info: { data }
    });
  }
  async getName() {
    return await this.#fetch("name(bytes32)");
  }
  /**
   *  Resolves to the avatar url or ``null`` if the avatar is either
   *  unconfigured or incorrectly configured (e.g. references an NFT
   *  not owned by the address).
   *
   *  If diagnosing issues with configurations, the [[_getAvatar]]
   *  method may be useful.
   */
  async getAvatar() {
    const avatar = await this._getAvatar();
    return avatar.url;
  }
  /**
   *  When resolving an avatar, there are many steps involved, such
   *  fetching metadata and possibly validating ownership of an
   *  NFT.
   *
   *  This method can be used to examine each step and the value it
   *  was working from.
   */
  async _getAvatar() {
    const linkage = [{ type: "name", value: this.name }];
    try {
      const avatar = await this.getText("avatar");
      if (avatar == null) {
        linkage.push({ type: "!avatar", value: "" });
        return { url: null, linkage };
      }
      linkage.push({ type: "avatar", value: avatar });
      for (let i = 0; i < matchers.length; i++) {
        const match = avatar.match(matchers[i]);
        if (match == null) {
          continue;
        }
        const scheme = match[1].toLowerCase();
        switch (scheme) {
          case "https":
          case "data":
            linkage.push({ type: "url", value: avatar });
            return { linkage, url: avatar };
          case "ipfs": {
            const url = getIpfsLink(avatar);
            linkage.push({ type: "ipfs", value: avatar });
            linkage.push({ type: "url", value: url });
            return { linkage, url };
          }
          case "erc721":
          case "erc1155": {
            const selector = scheme === "erc721" ? "tokenURI(uint256)" : "uri(uint256)";
            linkage.push({ type: scheme, value: avatar });
            const owner = await this.getAddress();
            if (owner == null) {
              linkage.push({ type: "!owner", value: "" });
              return { url: null, linkage };
            }
            const comps = (match[2] || "").split("/");
            if (comps.length !== 2) {
              linkage.push({ type: `!${scheme}caip`, value: match[2] || "" });
              return { url: null, linkage };
            }
            const tokenId = comps[1];
            const contract = new Contract(comps[0], [
              // ERC-721
              "function tokenURI(uint) view returns (string)",
              "function ownerOf(uint) view returns (address)",
              // ERC-1155
              "function uri(uint) view returns (string)",
              "function balanceOf(address, uint256) view returns (uint)"
            ], this.provider);
            if (scheme === "erc721") {
              const tokenOwner = await contract.ownerOf(tokenId);
              if (owner !== tokenOwner) {
                linkage.push({ type: "!owner", value: tokenOwner });
                return { url: null, linkage };
              }
              linkage.push({ type: "owner", value: tokenOwner });
            } else if (scheme === "erc1155") {
              const balance = await contract.balanceOf(owner, tokenId);
              if (!balance) {
                linkage.push({ type: "!balance", value: "0" });
                return { url: null, linkage };
              }
              linkage.push({ type: "balance", value: balance.toString() });
            }
            let metadataUrl = await contract[selector](tokenId);
            if (metadataUrl == null || metadataUrl === "0x") {
              linkage.push({ type: "!metadata-url", value: "" });
              return { url: null, linkage };
            }
            linkage.push({ type: "metadata-url-base", value: metadataUrl });
            if (scheme === "erc1155") {
              metadataUrl = metadataUrl.replace("{id}", toBeHex(tokenId, 32).substring(2));
              linkage.push({ type: "metadata-url-expanded", value: metadataUrl });
            }
            if (metadataUrl.match(/^ipfs:/i)) {
              metadataUrl = getIpfsLink(metadataUrl);
            }
            linkage.push({ type: "metadata-url", value: metadataUrl });
            let metadata = {};
            const response = await new FetchRequest(metadataUrl).send();
            response.assertOk();
            try {
              metadata = response.bodyJson;
            } catch (error) {
              try {
                linkage.push({ type: "!metadata", value: response.bodyText });
              } catch (error2) {
                const bytes2 = response.body;
                if (bytes2) {
                  linkage.push({ type: "!metadata", value: hexlify(bytes2) });
                }
                return { url: null, linkage };
              }
              return { url: null, linkage };
            }
            if (!metadata) {
              linkage.push({ type: "!metadata", value: "" });
              return { url: null, linkage };
            }
            linkage.push({ type: "metadata", value: JSON.stringify(metadata) });
            let imageUrl = metadata.image;
            if (typeof imageUrl !== "string") {
              linkage.push({ type: "!imageUrl", value: "" });
              return { url: null, linkage };
            }
            if (imageUrl.match(/^(https:\/\/|data:)/i)) {
            } else {
              const ipfs = imageUrl.match(matcherIpfs);
              if (ipfs == null) {
                linkage.push({ type: "!imageUrl-ipfs", value: imageUrl });
                return { url: null, linkage };
              }
              linkage.push({ type: "imageUrl-ipfs", value: imageUrl });
              imageUrl = getIpfsLink(imageUrl);
            }
            linkage.push({ type: "url", value: imageUrl });
            return { linkage, url: imageUrl };
          }
        }
      }
    } catch (error) {
    }
    return { linkage, url: null };
  }
  static async getEnsAddress(provider) {
    const network = await provider.getNetwork();
    const ensPlugin = network.getPlugin("org.ethers.plugins.network.Ens");
    assert(ensPlugin, "network does not support ENS", "UNSUPPORTED_OPERATION", {
      operation: "getEnsAddress",
      info: { network }
    });
    return ensPlugin.address;
  }
  static async getUniversalResolverAddress(provider) {
    const network = await provider.getNetwork();
    const ensPlugin = network.getPlugin("org.ethers.plugins.network.Ens");
    if (ensPlugin && ensPlugin.universalResolver) {
      return ensPlugin.universalResolver;
    }
    return null;
  }
  static async #getResolver(provider, name) {
    const ensAddr = await _EnsResolver.getEnsAddress(provider);
    try {
      const contract = new Contract(ensAddr, [
        "function resolver(bytes32) view returns (address)"
      ], provider);
      const addr = await contract.resolver(namehash(name), {
        enableCcipRead: true
      });
      if (addr === ZeroAddress) {
        return null;
      }
      return addr;
    } catch (error) {
      throw error;
    }
    return null;
  }
  static async lookupAddress(provider, address, _coinType) {
    const coinType = _coinType == null ? BN_60 : getBigInt(_coinType);
    if (isEvmCoinType(coinType)) {
      address = getAddress(address);
    }
    const universal = await createUniversal(provider);
    if (universal) {
      try {
        const result2 = await universal.reverse(address, coinType, {
          enableCcipRead: true
        });
        const addr = result2.primary;
        if (!isValidName(addr)) {
          return null;
        }
        return addr;
      } catch (e) {
        if (isError(e, "CALL_EXCEPTION") && e.reason === "ResolverNotFound(bytes)") {
          return null;
        }
        throw e;
      }
    }
    assert(coinType === BN_60, "lookupAddress coinType requires ENS Universal Resolver", "UNSUPPORTED_OPERATION", {
      operation: "lookupAddress"
    });
    try {
      const resolver = await _EnsResolver.fromName(provider, `${address.toLowerCase().substring(2)}.addr.reverse`);
      if (!resolver) {
        return null;
      }
      const name = await resolver.getName();
      if (name == null || !isValidName(name)) {
        return null;
      }
      const check = await provider.resolveName(name);
      if (check !== address) {
        return null;
      }
      return name;
    } catch (error) {
      if (isError(error, "BAD_DATA") && error.value === "0x") {
        return null;
      }
      if (isError(error, "CALL_EXCEPTION")) {
        return null;
      }
      throw error;
    }
  }
  /**
   *  Resolve to the ENS resolver for %%name%% using %%provider%% or
   *  ``null`` if unconfigured.
   */
  static async fromName(provider, name) {
    const universal = await createUniversal(provider);
    if (universal) {
      let dnsName;
      try {
        dnsName = dnsEncode(ensNormalize(name), 255);
      } catch (error) {
        return null;
      }
      const result2 = await universal.requireResolver(dnsName);
      return new _EnsResolver(provider, result2.resolver, name, result2.extended);
    }
    let currentName = name;
    while (true) {
      if (currentName === "" || currentName === ".") {
        return null;
      }
      if (name !== "eth" && currentName === "eth") {
        return null;
      }
      const addr = await _EnsResolver.#getResolver(provider, currentName);
      if (addr != null) {
        const resolver = new _EnsResolver(provider, addr, name);
        if (currentName !== name && !await resolver.supportsWildcard()) {
          return null;
        }
        return resolver;
      }
      currentName = currentName.split(".").slice(1).join(".");
    }
  }
};
async function createUniversal(provider) {
  const address = await EnsResolver.getUniversalResolverAddress(provider);
  if (!address) {
    return null;
  }
  return new Contract(address, [
    "function requireResolver(bytes) view returns ((bytes name, uint256 offset, bytes32 node, address resolver, bool extended))",
    "function findResolver(bytes) view returns (address resolver, bytes32 node, uint offset)",
    "function resolve(bytes name, bytes data) view returns (bytes result, address resolver)",
    "function reverse(bytes name, uint coinType) view returns (string primary, address resolver, address reverseResolver)",
    "error ResolverNotFound(bytes name)",
    "error ResolverNotContract(bytes name, address resolver)",
    "error ReverseAddressMismatch(string primary, bytes primaryAddress)",
    "error HttpError(uint16 statusCode, string statusMessage)"
  ], provider);
}

// node_modules/ethers/lib.esm/providers/format.js
var BN_011 = BigInt(0);
function allowNull(format, nullValue) {
  return function(value) {
    if (value == null) {
      return nullValue;
    }
    return format(value);
  };
}
function arrayOf(format, allowNull2) {
  return (array) => {
    if (allowNull2 && array == null) {
      return null;
    }
    if (!Array.isArray(array)) {
      throw new Error("not an array");
    }
    return array.map((i) => format(i));
  };
}
function object(format, altNames) {
  return (value) => {
    const result2 = {};
    for (const key in format) {
      let srcKey = key;
      if (altNames && key in altNames && !(srcKey in value)) {
        for (const altKey of altNames[key]) {
          if (altKey in value) {
            srcKey = altKey;
            break;
          }
        }
      }
      try {
        const nv = format[key](value[srcKey]);
        if (nv !== void 0) {
          result2[key] = nv;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "not-an-error";
        assert(false, `invalid value for value.${key} (${message})`, "BAD_DATA", { value });
      }
    }
    return result2;
  };
}
function formatBoolean(value) {
  switch (value) {
    case true:
    case "true":
      return true;
    case false:
    case "false":
      return false;
  }
  assertArgument(false, `invalid boolean; ${JSON.stringify(value)}`, "value", value);
}
function formatData(value) {
  assertArgument(isHexString(value, true), "invalid data", "value", value);
  return value;
}
function formatHash(value) {
  assertArgument(isHexString(value, 32), "invalid hash", "value", value);
  return value;
}
var _formatLog = object({
  address: getAddress,
  blockHash: formatHash,
  blockNumber: getNumber,
  data: formatData,
  index: getNumber,
  removed: allowNull(formatBoolean, false),
  topics: arrayOf(formatHash),
  transactionHash: formatHash,
  transactionIndex: getNumber
}, {
  index: ["logIndex"]
});
function formatLog(value) {
  return _formatLog(value);
}
var _formatBlock = object({
  hash: allowNull(formatHash),
  parentHash: formatHash,
  parentBeaconBlockRoot: allowNull(formatHash, null),
  number: getNumber,
  timestamp: getNumber,
  nonce: allowNull(formatData),
  difficulty: getBigInt,
  gasLimit: getBigInt,
  gasUsed: getBigInt,
  stateRoot: allowNull(formatHash, null),
  receiptsRoot: allowNull(formatHash, null),
  transactionsRoot: allowNull(formatHash, null),
  blobGasUsed: allowNull(getBigInt, null),
  excessBlobGas: allowNull(getBigInt, null),
  miner: allowNull(getAddress),
  prevRandao: allowNull(formatHash, null),
  extraData: formatData,
  baseFeePerGas: allowNull(getBigInt)
}, {
  prevRandao: ["mixHash"]
});
function formatBlock(value) {
  const result2 = _formatBlock(value);
  result2.transactions = value.transactions.map((tx) => {
    if (typeof tx === "string") {
      return tx;
    }
    return formatTransactionResponse(tx);
  });
  return result2;
}
var _formatReceiptLog = object({
  transactionIndex: getNumber,
  blockNumber: getNumber,
  transactionHash: formatHash,
  address: getAddress,
  topics: arrayOf(formatHash),
  data: formatData,
  index: getNumber,
  blockHash: formatHash
}, {
  index: ["logIndex"]
});
function formatReceiptLog(value) {
  return _formatReceiptLog(value);
}
var _formatTransactionReceipt = object({
  to: allowNull(getAddress, null),
  from: allowNull(getAddress, null),
  contractAddress: allowNull(getAddress, null),
  // should be allowNull(hash), but broken-EIP-658 support is handled in receipt
  index: getNumber,
  root: allowNull(hexlify),
  gasUsed: getBigInt,
  blobGasUsed: allowNull(getBigInt, null),
  logsBloom: allowNull(formatData),
  blockHash: formatHash,
  hash: formatHash,
  logs: arrayOf(formatReceiptLog),
  blockNumber: getNumber,
  //confirmations: allowNull(getNumber, null),
  cumulativeGasUsed: getBigInt,
  effectiveGasPrice: allowNull(getBigInt),
  blobGasPrice: allowNull(getBigInt, null),
  status: allowNull(getNumber),
  type: allowNull(getNumber, 0)
}, {
  effectiveGasPrice: ["gasPrice"],
  hash: ["transactionHash"],
  index: ["transactionIndex"]
});
function formatTransactionReceipt(value) {
  return _formatTransactionReceipt(value);
}
function formatTransactionResponse(value) {
  if (value.to && getBigInt(value.to) === BN_011) {
    value.to = "0x0000000000000000000000000000000000000000";
  }
  const result2 = object({
    hash: formatHash,
    // Some nodes do not return this, usually test nodes (like Ganache)
    index: allowNull(getNumber, void 0),
    type: (value2) => {
      if (value2 === "0x" || value2 == null) {
        return 0;
      }
      return getNumber(value2);
    },
    accessList: allowNull(accessListify, null),
    blobVersionedHashes: allowNull(arrayOf(formatHash, true), null),
    authorizationList: allowNull(arrayOf((v) => {
      let sig;
      if (v.signature) {
        sig = v.signature;
      } else {
        let yParity = v.yParity;
        if (yParity === "0x1b") {
          yParity = 0;
        } else if (yParity === "0x1c") {
          yParity = 1;
        }
        sig = Object.assign({}, v, { yParity });
      }
      return {
        address: getAddress(v.address),
        chainId: getBigInt(v.chainId),
        nonce: getBigInt(v.nonce),
        signature: Signature.from(sig)
      };
    }, false), null),
    blockHash: allowNull(formatHash, null),
    blockNumber: allowNull(getNumber, null),
    transactionIndex: allowNull(getNumber, null),
    from: getAddress,
    // either (gasPrice) or (maxPriorityFeePerGas + maxFeePerGas) must be set
    gasPrice: allowNull(getBigInt),
    maxPriorityFeePerGas: allowNull(getBigInt),
    maxFeePerGas: allowNull(getBigInt),
    maxFeePerBlobGas: allowNull(getBigInt, null),
    gasLimit: getBigInt,
    to: allowNull(getAddress, null),
    value: getBigInt,
    nonce: getNumber,
    data: formatData,
    creates: allowNull(getAddress, null),
    chainId: allowNull(getBigInt, null)
  }, {
    data: ["input"],
    gasLimit: ["gas"],
    index: ["transactionIndex"]
  })(value);
  if (result2.to == null && result2.creates == null) {
    result2.creates = getCreateAddress(result2);
  }
  if ((value.type === 1 || value.type === 2) && value.accessList == null) {
    result2.accessList = [];
  }
  if (value.signature) {
    result2.signature = Signature.from(value.signature);
  } else {
    result2.signature = Signature.from(value);
  }
  if (result2.chainId == null) {
    const chainId = result2.signature.legacyChainId;
    if (chainId != null) {
      result2.chainId = chainId;
    }
  }
  if (result2.blockHash && getBigInt(result2.blockHash) === BN_011) {
    result2.blockHash = null;
  }
  return result2;
}

// node_modules/ethers/lib.esm/providers/plugins-network.js
var EnsAddress = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
var inspect3 = Symbol.for("nodejs.util.inspect.custom");
var NetworkPlugin = class _NetworkPlugin {
  /**
   *  The name of the plugin.
   *
   *  It is recommended to use reverse-domain-notation, which permits
   *  unique names with a known authority as well as hierarchal entries.
   */
  name;
  /**
   *  Creates a new **NetworkPlugin**.
   */
  constructor(name) {
    defineProperties(this, { name });
  }
  [inspect3]() {
    return this.toString();
  }
  toString() {
    return `${this.name} { }`;
  }
  /**
   *  Creates a copy of this plugin.
   */
  clone() {
    return new _NetworkPlugin(this.name);
  }
};
var GasCostPlugin = class _GasCostPlugin extends NetworkPlugin {
  /**
   *  The block number to treat these values as valid from.
   *
   *  This allows a hardfork to have updated values included as well as
   *  mulutiple hardforks to be supported.
   */
  effectiveBlock;
  /**
   *  The transactions base fee.
   */
  txBase;
  /**
   *  The fee for creating a new account.
   */
  txCreate;
  /**
   *  The fee per zero-byte in the data.
   */
  txDataZero;
  /**
   *  The fee per non-zero-byte in the data.
   */
  txDataNonzero;
  /**
   *  The fee per storage key in the [[link-eip-2930]] access list.
   */
  txAccessListStorageKey;
  /**
   *  The fee per address in the [[link-eip-2930]] access list.
   */
  txAccessListAddress;
  /**
   *  Creates a new GasCostPlugin from %%effectiveBlock%% until the
   *  latest block or another GasCostPlugin supercedes that block number,
   *  with the associated %%costs%%.
   */
  constructor(effectiveBlock, costs) {
    if (effectiveBlock == null) {
      effectiveBlock = 0;
    }
    super(`org.ethers.network.plugins.GasCost#${effectiveBlock || 0}`);
    const props = { effectiveBlock };
    function set(name, nullish) {
      let value = (costs || {})[name];
      if (value == null) {
        value = nullish;
      }
      assertArgument(typeof value === "number", `invalud value for ${name}`, "costs", costs);
      props[name] = value;
    }
    set("txBase", 21e3);
    set("txCreate", 32e3);
    set("txDataZero", 4);
    set("txDataNonzero", 16);
    set("txAccessListStorageKey", 1900);
    set("txAccessListAddress", 2400);
    defineProperties(this, props);
  }
  toString() {
    return `${this.name} { txBase: ${this.txBase}, txCreate: ${this.txCreate}, txDataZero: ${this.txDataZero}, txAccessListStorageKey: ${this.txAccessListStorageKey}, txAccessListAddress: ${this.txAccessListAddress} }`;
  }
  clone() {
    return new _GasCostPlugin(this.effectiveBlock, this);
  }
};
var EnsPlugin = class _EnsPlugin extends NetworkPlugin {
  /**
   *  The ENS Registrty Contract address.
   */
  address;
  /**
   *  The chain ID that the ENS contract lives on.
   */
  targetNetwork;
  /**
   *  The Universal Resolver Contract Address.
   */
  universalResolver;
  /**
   *  Creates a new **EnsPlugin** connected to %%address%% on the
   *  %%targetNetwork%%. The default ENS address and mainnet is used
   *  if unspecified.
   */
  constructor(address, targetNetwork, universalResolver) {
    super("org.ethers.plugins.network.Ens");
    defineProperties(this, {
      address: address || EnsAddress,
      targetNetwork: targetNetwork == null ? 1 : targetNetwork,
      universalResolver
    });
  }
  toString() {
    return `${this.name} { address: ${this.address}, targetNetwork: ${this.targetNetwork}, universalResolver: ${this.universalResolver} }`;
  }
  clone() {
    return new _EnsPlugin(this.address, this.targetNetwork, this.universalResolver);
  }
};
var FetchUrlFeeDataNetworkPlugin = class extends NetworkPlugin {
  #url;
  #processFunc;
  /**
   *  The URL to initialize the FetchRequest with in %%processFunc%%.
   */
  get url() {
    return this.#url;
  }
  /**
   *  The callback to use when computing the FeeData.
   */
  get processFunc() {
    return this.#processFunc;
  }
  /**
   *  Creates a new **FetchUrlFeeDataNetworkPlugin** which will
   *  be used when computing the fee data for the network.
   */
  constructor(url, processFunc) {
    super("org.ethers.plugins.network.FetchUrlFeeDataPlugin");
    this.#url = url;
    this.#processFunc = processFunc;
  }
  toString() {
    return `${this.name} { url: ${this.url} }`;
  }
  // We are immutable, so we can serve as our own clone
  clone() {
    return this;
  }
};

// node_modules/ethers/lib.esm/providers/network.js
var inspect4 = Symbol.for("nodejs.util.inspect.custom");
var Networks = /* @__PURE__ */ new Map();
var Network = class _Network {
  #name;
  #chainId;
  #plugins;
  /**
   *  Creates a new **Network** for %%name%% and %%chainId%%.
   */
  constructor(name, chainId) {
    this.#name = name;
    this.#chainId = getBigInt(chainId);
    this.#plugins = /* @__PURE__ */ new Map();
  }
  [inspect4]() {
    return this.toString();
  }
  toString() {
    const plugins = [];
    for (const plugin of this.#plugins.values()) {
      plugins.push(plugin.toString());
    }
    return `Network { name: ${this.name}, chainId: ${this.chainId}, plugins: [ ${plugins.join(", ")} ] }`;
  }
  /**
   *  Returns a JSON-compatible representation of a Network.
   */
  toJSON() {
    return { name: this.name, chainId: String(this.chainId) };
  }
  /**
   *  The network common name.
   *
   *  This is the canonical name, as networks migh have multiple
   *  names.
   */
  get name() {
    return this.#name;
  }
  set name(value) {
    this.#name = value;
  }
  /**
   *  The network chain ID.
   */
  get chainId() {
    return this.#chainId;
  }
  set chainId(value) {
    this.#chainId = getBigInt(value, "chainId");
  }
  /**
   *  Returns true if %%other%% matches this network. Any chain ID
   *  must match, and if no chain ID is present, the name must match.
   *
   *  This method does not currently check for additional properties,
   *  such as ENS address or plug-in compatibility.
   */
  matches(other) {
    if (other == null) {
      return false;
    }
    if (typeof other === "string") {
      try {
        return this.chainId === getBigInt(other);
      } catch (error) {
      }
      return this.name === other;
    }
    if (typeof other === "number" || typeof other === "bigint") {
      try {
        return this.chainId === getBigInt(other);
      } catch (error) {
      }
      return false;
    }
    if (typeof other === "object") {
      if (other.chainId != null) {
        try {
          return this.chainId === getBigInt(other.chainId);
        } catch (error) {
        }
        return false;
      }
      if (other.name != null) {
        return this.name === other.name;
      }
      return false;
    }
    return false;
  }
  /**
   *  Returns the list of plugins currently attached to this Network.
   */
  get plugins() {
    return Array.from(this.#plugins.values());
  }
  /**
   *  Attach a new %%plugin%% to this Network. The network name
   *  must be unique, excluding any fragment.
   */
  attachPlugin(plugin) {
    if (this.#plugins.get(plugin.name)) {
      throw new Error(`cannot replace existing plugin: ${plugin.name} `);
    }
    this.#plugins.set(plugin.name, plugin.clone());
    return this;
  }
  /**
   *  Return the plugin, if any, matching %%name%% exactly. Plugins
   *  with fragments will not be returned unless %%name%% includes
   *  a fragment.
   */
  getPlugin(name) {
    return this.#plugins.get(name) || null;
  }
  /**
   *  Gets a list of all plugins that match %%name%%, with otr without
   *  a fragment.
   */
  getPlugins(basename) {
    return this.plugins.filter((p) => p.name.split("#")[0] === basename);
  }
  /**
   *  Create a copy of this Network.
   */
  clone() {
    const clone = new _Network(this.name, this.chainId);
    this.plugins.forEach((plugin) => {
      clone.attachPlugin(plugin.clone());
    });
    return clone;
  }
  /**
   *  Compute the intrinsic gas required for a transaction.
   *
   *  A GasCostPlugin can be attached to override the default
   *  values.
   */
  computeIntrinsicGas(tx) {
    const costs = this.getPlugin("org.ethers.plugins.network.GasCost") || new GasCostPlugin();
    let gas = costs.txBase;
    if (tx.to == null) {
      gas += costs.txCreate;
    }
    if (tx.data) {
      for (let i = 2; i < tx.data.length; i += 2) {
        if (tx.data.substring(i, i + 2) === "00") {
          gas += costs.txDataZero;
        } else {
          gas += costs.txDataNonzero;
        }
      }
    }
    if (tx.accessList) {
      const accessList = accessListify(tx.accessList);
      for (const addr in accessList) {
        gas += costs.txAccessListAddress + costs.txAccessListStorageKey * accessList[addr].storageKeys.length;
      }
    }
    return gas;
  }
  /**
   *  Returns a new Network for the %%network%% name or chainId.
   */
  static from(network) {
    injectCommonNetworks();
    if (network == null) {
      return _Network.from("mainnet");
    }
    if (typeof network === "number") {
      network = BigInt(network);
    }
    if (typeof network === "string" || typeof network === "bigint") {
      const networkFunc = Networks.get(network);
      if (networkFunc) {
        return networkFunc();
      }
      if (typeof network === "bigint") {
        return new _Network("unknown", network);
      }
      assertArgument(false, "unknown network", "network", network);
    }
    if (typeof network.clone === "function") {
      const clone = network.clone();
      return clone;
    }
    if (typeof network === "object") {
      assertArgument(typeof network.name === "string" && typeof network.chainId === "number", "invalid network object name or chainId", "network", network);
      const custom = new _Network(network.name, network.chainId);
      const n2 = network;
      if (n2.ensAddress || n2.ensNetwork != null || n2.ensUniversalResolver) {
        custom.attachPlugin(new EnsPlugin(n2.ensAddress, n2.ensNetwork, n2.ensUniversalResolver));
      }
      return custom;
    }
    assertArgument(false, "invalid network", "network", network);
  }
  /**
   *  Register %%nameOrChainId%% with a function which returns
   *  an instance of a Network representing that chain.
   */
  static register(nameOrChainId, networkFunc) {
    if (typeof nameOrChainId === "number") {
      nameOrChainId = BigInt(nameOrChainId);
    }
    const existing = Networks.get(nameOrChainId);
    if (existing) {
      assertArgument(false, `conflicting network for ${JSON.stringify(existing.name)}`, "nameOrChainId", nameOrChainId);
    }
    Networks.set(nameOrChainId, networkFunc);
  }
};
function parseUnits2(_value, decimals) {
  const value = String(_value);
  if (!value.match(/^[0-9.]+$/)) {
    throw new Error(`invalid gwei value: ${_value}`);
  }
  const comps = value.split(".");
  if (comps.length === 1) {
    comps.push("");
  }
  if (comps.length !== 2) {
    throw new Error(`invalid gwei value: ${_value}`);
  }
  while (comps[1].length < decimals) {
    comps[1] += "0";
  }
  if (comps[1].length > 9) {
    let frac = BigInt(comps[1].substring(0, 9));
    if (!comps[1].substring(9).match(/^0+$/)) {
      frac++;
    }
    comps[1] = frac.toString();
  }
  return BigInt(comps[0] + comps[1]);
}
function getGasStationPlugin(url) {
  return new FetchUrlFeeDataNetworkPlugin(url, async (fetchFeeData, provider, request) => {
    request.setHeader("User-Agent", "ethers");
    let response;
    try {
      const [_response, _feeData] = await Promise.all([
        request.send(),
        fetchFeeData()
      ]);
      response = _response;
      const payload = response.bodyJson.standard;
      const feeData = {
        gasPrice: _feeData.gasPrice,
        maxFeePerGas: parseUnits2(payload.maxFee, 9),
        maxPriorityFeePerGas: parseUnits2(payload.maxPriorityFee, 9)
      };
      return feeData;
    } catch (error) {
      assert(false, `error encountered with polygon gas station (${JSON.stringify(request.url)})`, "SERVER_ERROR", { request, response, error });
    }
  });
}
var injected = false;
function injectCommonNetworks() {
  if (injected) {
    return;
  }
  injected = true;
  function registerEth(name, chainId, options2) {
    const func = function() {
      const network = new Network(name, chainId);
      if (options2.ensNetwork != null) {
        network.attachPlugin(new EnsPlugin(null, options2.ensNetwork, options2.ensUniversalResolver));
      }
      network.attachPlugin(new GasCostPlugin());
      (options2.plugins || []).forEach((plugin) => {
        network.attachPlugin(plugin);
      });
      return network;
    };
    Network.register(name, func);
    Network.register(chainId, func);
    if (options2.altNames) {
      options2.altNames.forEach((name2) => {
        Network.register(name2, func);
      });
    }
  }
  const ensUniversalResolver = "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe";
  registerEth("mainnet", 1, {
    ensUniversalResolver,
    ensNetwork: 1,
    altNames: ["homestead"]
  });
  registerEth("ropsten", 3, { ensNetwork: 3 });
  registerEth("rinkeby", 4, { ensNetwork: 4 });
  registerEth("goerli", 5, { ensNetwork: 5 });
  registerEth("kovan", 42, { ensNetwork: 42 });
  registerEth("sepolia", 11155111, {
    ensUniversalResolver,
    ensNetwork: 11155111
  });
  registerEth("holesky", 17e3, { ensNetwork: 17e3 });
  registerEth("classic", 61, {});
  registerEth("classicKotti", 6, {});
  registerEth("arbitrum", 42161, {
    ensNetwork: 1
  });
  registerEth("arbitrum-goerli", 421613, {});
  registerEth("arbitrum-sepolia", 421614, {});
  registerEth("base", 8453, { ensNetwork: 1 });
  registerEth("base-goerli", 84531, {});
  registerEth("base-sepolia", 84532, {});
  registerEth("bnb", 56, { ensNetwork: 1 });
  registerEth("bnbt", 97, {});
  registerEth("filecoin", 314, {});
  registerEth("filecoin-calibration", 314159, {});
  registerEth("linea", 59144, { ensNetwork: 1 });
  registerEth("linea-goerli", 59140, {});
  registerEth("linea-sepolia", 59141, {});
  registerEth("matic", 137, {
    ensNetwork: 1,
    plugins: [
      getGasStationPlugin("https://gasstation.polygon.technology/v2")
    ]
  });
  registerEth("matic-amoy", 80002, {});
  registerEth("matic-mumbai", 80001, {
    altNames: ["maticMumbai", "maticmum"],
    plugins: [
      getGasStationPlugin("https://gasstation-testnet.polygon.technology/v2")
    ]
  });
  registerEth("optimism", 10, {
    ensNetwork: 1,
    plugins: []
  });
  registerEth("optimism-goerli", 420, {});
  registerEth("optimism-sepolia", 11155420, {});
  registerEth("xdai", 100, { ensNetwork: 1 });
}

// node_modules/ethers/lib.esm/providers/subscriber-polling.js
function copy(obj) {
  return JSON.parse(JSON.stringify(obj));
}
var PollingBlockSubscriber = class {
  #provider;
  #poller;
  #interval;
  // The most recent block we have scanned for events. The value -2
  // indicates we still need to fetch an initial block number
  #blockNumber;
  /**
   *  Create a new **PollingBlockSubscriber** attached to %%provider%%.
   */
  constructor(provider) {
    this.#provider = provider;
    this.#poller = null;
    this.#interval = 4e3;
    this.#blockNumber = -2;
  }
  /**
   *  The polling interval.
   */
  get pollingInterval() {
    return this.#interval;
  }
  set pollingInterval(value) {
    this.#interval = value;
  }
  async #poll() {
    try {
      const blockNumber = await this.#provider.getBlockNumber();
      if (this.#blockNumber === -2) {
        this.#blockNumber = blockNumber;
        return;
      }
      if (blockNumber !== this.#blockNumber) {
        for (let b2 = this.#blockNumber + 1; b2 <= blockNumber; b2++) {
          if (this.#poller == null) {
            return;
          }
          await this.#provider.emit("block", b2);
        }
        this.#blockNumber = blockNumber;
      }
    } catch (error) {
    }
    if (this.#poller == null) {
      return;
    }
    this.#poller = this.#provider._setTimeout(this.#poll.bind(this), this.#interval);
  }
  start() {
    if (this.#poller) {
      return;
    }
    this.#poller = this.#provider._setTimeout(this.#poll.bind(this), this.#interval);
    this.#poll();
  }
  stop() {
    if (!this.#poller) {
      return;
    }
    this.#provider._clearTimeout(this.#poller);
    this.#poller = null;
  }
  pause(dropWhilePaused) {
    this.stop();
    if (dropWhilePaused) {
      this.#blockNumber = -2;
    }
  }
  resume() {
    this.start();
  }
};
var OnBlockSubscriber = class {
  #provider;
  #poll;
  #running;
  /**
   *  Create a new **OnBlockSubscriber** attached to %%provider%%.
   */
  constructor(provider) {
    this.#provider = provider;
    this.#running = false;
    this.#poll = (blockNumber) => {
      this._poll(blockNumber, this.#provider);
    };
  }
  /**
   *  Called on every new block.
   */
  async _poll(blockNumber, provider) {
    throw new Error("sub-classes must override this");
  }
  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#poll(-2);
    this.#provider.on("block", this.#poll);
  }
  stop() {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#provider.off("block", this.#poll);
  }
  pause(dropWhilePaused) {
    this.stop();
  }
  resume() {
    this.start();
  }
};
var PollingBlockTagSubscriber = class extends OnBlockSubscriber {
  #tag;
  #lastBlock;
  constructor(provider, tag) {
    super(provider);
    this.#tag = tag;
    this.#lastBlock = -2;
  }
  pause(dropWhilePaused) {
    if (dropWhilePaused) {
      this.#lastBlock = -2;
    }
    super.pause(dropWhilePaused);
  }
  async _poll(blockNumber, provider) {
    const block = await provider.getBlock(this.#tag);
    if (block == null) {
      return;
    }
    if (this.#lastBlock === -2) {
      this.#lastBlock = block.number;
    } else if (block.number > this.#lastBlock) {
      provider.emit(this.#tag, block.number);
      this.#lastBlock = block.number;
    }
  }
};
var PollingOrphanSubscriber = class extends OnBlockSubscriber {
  #filter;
  constructor(provider, filter) {
    super(provider);
    this.#filter = copy(filter);
  }
  async _poll(blockNumber, provider) {
    throw new Error("@TODO");
    console.log(this.#filter);
  }
};
var PollingTransactionSubscriber = class extends OnBlockSubscriber {
  #hash;
  /**
   *  Create a new **PollingTransactionSubscriber** attached to
   *  %%provider%%, listening for %%hash%%.
   */
  constructor(provider, hash2) {
    super(provider);
    this.#hash = hash2;
  }
  async _poll(blockNumber, provider) {
    const tx = await provider.getTransactionReceipt(this.#hash);
    if (tx) {
      provider.emit(this.#hash, tx);
    }
  }
};
var PollingEventSubscriber = class {
  #provider;
  #filter;
  #poller;
  #running;
  // The most recent block we have scanned for events. The value -2
  // indicates we still need to fetch an initial block number
  #blockNumber;
  /**
   *  Create a new **PollingTransactionSubscriber** attached to
   *  %%provider%%, listening for %%filter%%.
   */
  constructor(provider, filter) {
    this.#provider = provider;
    this.#filter = copy(filter);
    this.#poller = this.#poll.bind(this);
    this.#running = false;
    this.#blockNumber = -2;
  }
  async #poll(blockNumber) {
    if (this.#blockNumber === -2) {
      return;
    }
    const filter = copy(this.#filter);
    filter.fromBlock = this.#blockNumber + 1;
    filter.toBlock = blockNumber;
    const logs = await this.#provider.getLogs(filter);
    if (logs.length === 0) {
      if (this.#blockNumber < blockNumber - 60) {
        this.#blockNumber = blockNumber - 60;
      }
      return;
    }
    for (const log of logs) {
      this.#provider.emit(this.#filter, log);
      this.#blockNumber = log.blockNumber;
    }
  }
  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    if (this.#blockNumber === -2) {
      this.#provider.getBlockNumber().then((blockNumber) => {
        this.#blockNumber = blockNumber;
      });
    }
    this.#provider.on("block", this.#poller);
  }
  stop() {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#provider.off("block", this.#poller);
  }
  pause(dropWhilePaused) {
    this.stop();
    if (dropWhilePaused) {
      this.#blockNumber = -2;
    }
  }
  resume() {
    this.start();
  }
};

// node_modules/ethers/lib.esm/providers/abstract-provider.js
var BN_23 = BigInt(2);
var MAX_CCIP_REDIRECTS = 10;
function stall(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}
function isPromise(value) {
  return value && typeof value.then === "function";
}
function getTag(prefix, value) {
  return prefix + ":" + JSON.stringify(value, (k, v) => {
    if (v == null) {
      return "null";
    }
    if (typeof v === "bigint") {
      return `bigint:${v.toString()}`;
    }
    if (typeof v === "string") {
      return v.toLowerCase();
    }
    if (typeof v === "object" && !Array.isArray(v)) {
      const keys = Object.keys(v);
      keys.sort();
      return keys.reduce((accum, key) => {
        accum[key] = v[key];
        return accum;
      }, {});
    }
    return v;
  });
}
var UnmanagedSubscriber = class {
  /**
   *  The name fof the event.
   */
  name;
  /**
   *  Create a new UnmanagedSubscriber with %%name%%.
   */
  constructor(name) {
    defineProperties(this, { name });
  }
  start() {
  }
  stop() {
  }
  pause(dropWhilePaused) {
  }
  resume() {
  }
};
function copy2(value) {
  return JSON.parse(JSON.stringify(value));
}
function concisify(items) {
  items = Array.from(new Set(items).values());
  items.sort();
  return items;
}
async function getSubscription(_event, provider) {
  if (_event == null) {
    throw new Error("invalid event");
  }
  if (Array.isArray(_event)) {
    _event = { topics: _event };
  }
  if (typeof _event === "string") {
    switch (_event) {
      case "block":
      case "debug":
      case "error":
      case "finalized":
      case "network":
      case "pending":
      case "safe": {
        return { type: _event, tag: _event };
      }
    }
  }
  if (isHexString(_event, 32)) {
    const hash2 = _event.toLowerCase();
    return { type: "transaction", tag: getTag("tx", { hash: hash2 }), hash: hash2 };
  }
  if (_event.orphan) {
    const event = _event;
    return { type: "orphan", tag: getTag("orphan", event), filter: copy2(event) };
  }
  if (_event.address || _event.topics) {
    const event = _event;
    const filter = {
      topics: (event.topics || []).map((t) => {
        if (t == null) {
          return null;
        }
        if (Array.isArray(t)) {
          return concisify(t.map((t2) => t2.toLowerCase()));
        }
        return t.toLowerCase();
      })
    };
    if (event.address) {
      const addresses = [];
      const promises = [];
      const addAddress = (addr) => {
        if (isHexString(addr)) {
          addresses.push(addr);
        } else {
          promises.push((async () => {
            addresses.push(await resolveAddress(addr, provider));
          })());
        }
      };
      if (Array.isArray(event.address)) {
        event.address.forEach(addAddress);
      } else {
        addAddress(event.address);
      }
      if (promises.length) {
        await Promise.all(promises);
      }
      filter.address = concisify(addresses.map((a) => a.toLowerCase()));
    }
    return { filter, tag: getTag("event", filter), type: "event" };
  }
  assertArgument(false, "unknown ProviderEvent", "event", _event);
}
function getTime2() {
  return (/* @__PURE__ */ new Date()).getTime();
}
var defaultOptions = {
  cacheTimeout: 250,
  pollingInterval: 4e3
};
var AbstractProvider = class {
  #subs;
  #plugins;
  // null=unpaused, true=paused+dropWhilePaused, false=paused
  #pausedState;
  #destroyed;
  #networkPromise;
  #anyNetwork;
  #performCache;
  // The most recent block number if running an event or -1 if no "block" event
  #lastBlockNumber;
  #nextTimer;
  #timers;
  #disableCcipRead;
  #requestRate;
  #requestTimes;
  #options;
  /**
   *  Create a new **AbstractProvider** connected to %%network%%, or
   *  use the various network detection capabilities to discover the
   *  [[Network]] if necessary.
   */
  constructor(_network, options2) {
    this.#options = Object.assign({}, defaultOptions, options2 || {});
    if (_network === "any") {
      this.#anyNetwork = true;
      this.#networkPromise = null;
    } else if (_network) {
      const network = Network.from(_network);
      this.#anyNetwork = false;
      this.#networkPromise = Promise.resolve(network);
      setTimeout(() => {
        this.emit("network", network, null);
      }, 0);
    } else {
      this.#anyNetwork = false;
      this.#networkPromise = null;
    }
    this.#lastBlockNumber = -1;
    this.#performCache = /* @__PURE__ */ new Map();
    this.#subs = /* @__PURE__ */ new Map();
    this.#plugins = /* @__PURE__ */ new Map();
    this.#pausedState = null;
    this.#destroyed = false;
    this.#nextTimer = 1;
    this.#timers = /* @__PURE__ */ new Map();
    this.#disableCcipRead = false;
    this.#requestRate = 0;
    this.#requestTimes = [];
  }
  /**
   *  Limit the number of requests per second. (default: no limit)
   */
  get _requestRate() {
    const value = this.#requestRate;
    if (value == 0) {
      return null;
    }
    return value;
  }
  set _requestRate(value) {
    if (value == null || value < 0) {
      value = 0;
    }
    this.#requestRate = getNumber(value);
  }
  get pollingInterval() {
    return this.#options.pollingInterval;
  }
  /**
   *  Returns ``this``, to allow an **AbstractProvider** to implement
   *  the [[ContractRunner]] interface.
   */
  get provider() {
    return this;
  }
  /**
   *  Returns all the registered plug-ins.
   */
  get plugins() {
    return Array.from(this.#plugins.values());
  }
  /**
   *  Attach a new plug-in.
   */
  attachPlugin(plugin) {
    if (this.#plugins.get(plugin.name)) {
      throw new Error(`cannot replace existing plugin: ${plugin.name} `);
    }
    this.#plugins.set(plugin.name, plugin.connect(this));
    return this;
  }
  /**
   *  Get a plugin by name.
   */
  getPlugin(name) {
    return this.#plugins.get(name) || null;
  }
  /**
   *  Prevent any CCIP-read operation, regardless of whether requested
   *  in a [[call]] using ``enableCcipRead``.
   */
  get disableCcipRead() {
    return this.#disableCcipRead;
  }
  set disableCcipRead(value) {
    this.#disableCcipRead = !!value;
  }
  #getDelay() {
    let requestRate = this.#requestRate;
    if (requestRate === 0) {
      return 0;
    }
    const requests = this.#requestTimes;
    const now = getTime2();
    requests.push(now);
    const scanTime = now - 1e3;
    while (requests.length && requests[0] < scanTime) {
      requests.shift();
    }
    if (requests.length < requestRate) {
      return 0;
    }
    return requests[0] + 1e3 - now;
  }
  // Shares multiple identical requests made during the same 250ms
  async #perform(req) {
    const timeout = this.#options.cacheTimeout;
    if (timeout < 0) {
      const delay = this.#getDelay();
      if (delay) {
        await stall(delay);
      }
      return await this._perform(req);
    }
    const tag = getTag(req.method, req);
    let perform = this.#performCache.get(tag);
    if (!perform) {
      const delay = this.#getDelay();
      if (delay) {
        await stall(delay);
      }
      perform = this._perform(req);
      this.#performCache.set(tag, perform);
      setTimeout(() => {
        if (this.#performCache.get(tag) === perform) {
          this.#performCache.delete(tag);
        }
      }, timeout);
    }
    return await perform;
  }
  /**
   *  Resolves to the data for executing the CCIP-read operations.
   */
  async ccipReadFetch(tx, calldata, urls) {
    if (this.disableCcipRead || urls.length === 0 || tx.to == null) {
      return null;
    }
    const sender = tx.to.toLowerCase();
    const data = calldata.toLowerCase();
    const errorMessages = [];
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const href = url.replace("{sender}", sender).replace("{data}", data);
      const request = new FetchRequest(href);
      if (url.indexOf("{data}") === -1) {
        request.body = { data, sender };
      }
      this.emit("debug", { action: "sendCcipReadFetchRequest", request, index: i, urls });
      let errorMessage = "unknown error";
      let resp;
      try {
        resp = await request.send();
      } catch (error) {
        errorMessages.push(error.message);
        this.emit("debug", { action: "receiveCcipReadFetchError", request, result: { error } });
        continue;
      }
      try {
        const result2 = resp.bodyJson;
        if (result2.data) {
          this.emit("debug", { action: "receiveCcipReadFetchResult", request, result: result2 });
          return result2.data;
        }
        if (result2.message) {
          errorMessage = result2.message;
        }
        this.emit("debug", { action: "receiveCcipReadFetchError", request, result: result2 });
      } catch (error) {
      }
      assert(resp.statusCode < 400 || resp.statusCode >= 500, `response not found during CCIP fetch: ${errorMessage}`, "OFFCHAIN_FAULT", { reason: "404_MISSING_RESOURCE", transaction: tx, info: { url, errorMessage } });
      errorMessages.push(errorMessage);
    }
    assert(false, `error encountered during CCIP fetch: ${errorMessages.map((m) => JSON.stringify(m)).join(", ")}`, "OFFCHAIN_FAULT", {
      reason: "500_SERVER_ERROR",
      transaction: tx,
      info: { urls, errorMessages }
    });
  }
  /**
   *  Provides the opportunity for a sub-class to wrap a block before
   *  returning it, to add additional properties or an alternate
   *  sub-class of [[Block]].
   */
  _wrapBlock(value, network) {
    return new Block(formatBlock(value), this);
  }
  /**
   *  Provides the opportunity for a sub-class to wrap a log before
   *  returning it, to add additional properties or an alternate
   *  sub-class of [[Log]].
   */
  _wrapLog(value, network) {
    return new Log(formatLog(value), this);
  }
  /**
   *  Provides the opportunity for a sub-class to wrap a transaction
   *  receipt before returning it, to add additional properties or an
   *  alternate sub-class of [[TransactionReceipt]].
   */
  _wrapTransactionReceipt(value, network) {
    return new TransactionReceipt(formatTransactionReceipt(value), this);
  }
  /**
   *  Provides the opportunity for a sub-class to wrap a transaction
   *  response before returning it, to add additional properties or an
   *  alternate sub-class of [[TransactionResponse]].
   */
  _wrapTransactionResponse(tx, network) {
    return new TransactionResponse(formatTransactionResponse(tx), this);
  }
  /**
   *  Resolves to the Network, forcing a network detection using whatever
   *  technique the sub-class requires.
   *
   *  Sub-classes **must** override this.
   */
  _detectNetwork() {
    assert(false, "sub-classes must implement this", "UNSUPPORTED_OPERATION", {
      operation: "_detectNetwork"
    });
  }
  /**
   *  Sub-classes should use this to perform all built-in operations. All
   *  methods sanitizes and normalizes the values passed into this.
   *
   *  Sub-classes **must** override this.
   */
  async _perform(req) {
    assert(false, `unsupported method: ${req.method}`, "UNSUPPORTED_OPERATION", {
      operation: req.method,
      info: req
    });
  }
  // State
  async getBlockNumber() {
    const blockNumber = getNumber(await this.#perform({ method: "getBlockNumber" }), "%response");
    if (this.#lastBlockNumber >= 0) {
      this.#lastBlockNumber = blockNumber;
    }
    return blockNumber;
  }
  /**
   *  Returns or resolves to the address for %%address%%, resolving ENS
   *  names and [[Addressable]] objects and returning if already an
   *  address.
   */
  _getAddress(address) {
    return resolveAddress(address, this);
  }
  /**
   *  Returns or resolves to a valid block tag for %%blockTag%%, resolving
   *  negative values and returning if already a valid block tag.
   */
  _getBlockTag(blockTag) {
    if (blockTag == null) {
      return "latest";
    }
    switch (blockTag) {
      case "earliest":
        return "0x0";
      case "finalized":
      case "latest":
      case "pending":
      case "safe":
        return blockTag;
    }
    if (isHexString(blockTag)) {
      if (isHexString(blockTag, 32)) {
        return blockTag;
      }
      return toQuantity(blockTag);
    }
    if (typeof blockTag === "bigint") {
      blockTag = getNumber(blockTag, "blockTag");
    }
    if (typeof blockTag === "number") {
      if (blockTag >= 0) {
        return toQuantity(blockTag);
      }
      if (this.#lastBlockNumber >= 0) {
        return toQuantity(this.#lastBlockNumber + blockTag);
      }
      return this.getBlockNumber().then((b2) => toQuantity(b2 + blockTag));
    }
    assertArgument(false, "invalid blockTag", "blockTag", blockTag);
  }
  /**
   *  Returns or resolves to a filter for %%filter%%, resolving any ENS
   *  names or [[Addressable]] object and returning if already a valid
   *  filter.
   */
  _getFilter(filter) {
    const topics = (filter.topics || []).map((t) => {
      if (t == null) {
        return null;
      }
      if (Array.isArray(t)) {
        return concisify(t.map((t2) => t2.toLowerCase()));
      }
      return t.toLowerCase();
    });
    const blockHash = "blockHash" in filter ? filter.blockHash : void 0;
    const resolve = (_address, fromBlock2, toBlock2) => {
      let address2 = void 0;
      switch (_address.length) {
        case 0:
          break;
        case 1:
          address2 = _address[0];
          break;
        default:
          _address.sort();
          address2 = _address;
      }
      if (blockHash) {
        if (fromBlock2 != null || toBlock2 != null) {
          throw new Error("invalid filter");
        }
      }
      const filter2 = {};
      if (address2) {
        filter2.address = address2;
      }
      if (topics.length) {
        filter2.topics = topics;
      }
      if (fromBlock2) {
        filter2.fromBlock = fromBlock2;
      }
      if (toBlock2) {
        filter2.toBlock = toBlock2;
      }
      if (blockHash) {
        filter2.blockHash = blockHash;
      }
      return filter2;
    };
    let address = [];
    if (filter.address) {
      if (Array.isArray(filter.address)) {
        for (const addr of filter.address) {
          address.push(this._getAddress(addr));
        }
      } else {
        address.push(this._getAddress(filter.address));
      }
    }
    let fromBlock = void 0;
    if ("fromBlock" in filter) {
      fromBlock = this._getBlockTag(filter.fromBlock);
    }
    let toBlock = void 0;
    if ("toBlock" in filter) {
      toBlock = this._getBlockTag(filter.toBlock);
    }
    if (address.filter((a) => typeof a !== "string").length || fromBlock != null && typeof fromBlock !== "string" || toBlock != null && typeof toBlock !== "string") {
      return Promise.all([Promise.all(address), fromBlock, toBlock]).then((result2) => {
        return resolve(result2[0], result2[1], result2[2]);
      });
    }
    return resolve(address, fromBlock, toBlock);
  }
  /**
   *  Returns or resolves to a transaction for %%request%%, resolving
   *  any ENS names or [[Addressable]] and returning if already a valid
   *  transaction.
   */
  _getTransactionRequest(_request) {
    const request = copyRequest(_request);
    const promises = [];
    ["to", "from"].forEach((key) => {
      if (request[key] == null) {
        return;
      }
      const addr = resolveAddress(request[key], this);
      if (isPromise(addr)) {
        promises.push(async function() {
          request[key] = await addr;
        }());
      } else {
        request[key] = addr;
      }
    });
    if (request.blockTag != null) {
      const blockTag = this._getBlockTag(request.blockTag);
      if (isPromise(blockTag)) {
        promises.push(async function() {
          request.blockTag = await blockTag;
        }());
      } else {
        request.blockTag = blockTag;
      }
    }
    if (promises.length) {
      return async function() {
        await Promise.all(promises);
        return request;
      }();
    }
    return request;
  }
  async getNetwork() {
    if (this.#networkPromise == null) {
      const detectNetwork = (async () => {
        try {
          const network = await this._detectNetwork();
          this.emit("network", network, null);
          return network;
        } catch (error) {
          if (this.#networkPromise === detectNetwork) {
            this.#networkPromise = null;
          }
          throw error;
        }
      })();
      this.#networkPromise = detectNetwork;
      return (await detectNetwork).clone();
    }
    const networkPromise = this.#networkPromise;
    const [expected, actual] = await Promise.all([
      networkPromise,
      this._detectNetwork()
      // The actual connected network
    ]);
    if (expected.chainId !== actual.chainId) {
      if (this.#anyNetwork) {
        this.emit("network", actual, expected);
        if (this.#networkPromise === networkPromise) {
          this.#networkPromise = Promise.resolve(actual);
        }
      } else {
        assert(false, `network changed: ${expected.chainId} => ${actual.chainId} `, "NETWORK_ERROR", {
          event: "changed"
        });
      }
    }
    return expected.clone();
  }
  async getFeeData() {
    const network = await this.getNetwork();
    const getFeeDataFunc = async () => {
      const { _block, gasPrice, priorityFee } = await resolveProperties({
        _block: this.#getBlock("latest", false),
        gasPrice: (async () => {
          try {
            const value = await this.#perform({ method: "getGasPrice" });
            return getBigInt(value, "%response");
          } catch (error) {
          }
          return null;
        })(),
        priorityFee: (async () => {
          try {
            const value = await this.#perform({ method: "getPriorityFee" });
            return getBigInt(value, "%response");
          } catch (error) {
          }
          return null;
        })()
      });
      let maxFeePerGas = null;
      let maxPriorityFeePerGas = null;
      const block = this._wrapBlock(_block, network);
      if (block && block.baseFeePerGas) {
        maxPriorityFeePerGas = priorityFee != null ? priorityFee : BigInt("1000000000");
        maxFeePerGas = block.baseFeePerGas * BN_23 + maxPriorityFeePerGas;
      }
      return new FeeData(gasPrice, maxFeePerGas, maxPriorityFeePerGas);
    };
    const plugin = network.getPlugin("org.ethers.plugins.network.FetchUrlFeeDataPlugin");
    if (plugin) {
      const req = new FetchRequest(plugin.url);
      const feeData = await plugin.processFunc(getFeeDataFunc, this, req);
      return new FeeData(feeData.gasPrice, feeData.maxFeePerGas, feeData.maxPriorityFeePerGas);
    }
    return await getFeeDataFunc();
  }
  async estimateGas(_tx) {
    let tx = this._getTransactionRequest(_tx);
    if (isPromise(tx)) {
      tx = await tx;
    }
    return getBigInt(await this.#perform({
      method: "estimateGas",
      transaction: tx
    }), "%response");
  }
  async #call(tx, blockTag, attempt) {
    assert(attempt < MAX_CCIP_REDIRECTS, "CCIP read exceeded maximum redirections", "OFFCHAIN_FAULT", {
      reason: "TOO_MANY_REDIRECTS",
      transaction: Object.assign({}, tx, { blockTag, enableCcipRead: true })
    });
    const transaction = copyRequest(tx);
    try {
      const delay = this.#getDelay();
      if (delay) {
        await stall(delay);
      }
      return hexlify(await this._perform({ method: "call", transaction, blockTag }));
    } catch (error) {
      if (!this.disableCcipRead && isCallException(error) && error.data && attempt >= 0 && blockTag === "latest" && transaction.to != null && dataSlice(error.data, 0, 4) === "0x556f1830") {
        const data = error.data;
        const txSender = await resolveAddress(transaction.to, this);
        let ccipArgs;
        try {
          ccipArgs = parseOffchainLookup(dataSlice(error.data, 4));
        } catch (error2) {
          assert(false, error2.message, "OFFCHAIN_FAULT", {
            reason: "BAD_DATA",
            transaction,
            info: { data }
          });
        }
        assert(ccipArgs.sender.toLowerCase() === txSender.toLowerCase(), "CCIP Read sender mismatch", "CALL_EXCEPTION", {
          action: "call",
          data,
          reason: "OffchainLookup",
          transaction,
          invocation: null,
          revert: {
            signature: "OffchainLookup(address,string[],bytes,bytes4,bytes)",
            name: "OffchainLookup",
            args: ccipArgs.errorArgs
          }
        });
        const ccipResult = await this.ccipReadFetch(transaction, ccipArgs.calldata, ccipArgs.urls);
        assert(ccipResult != null, "CCIP Read failed to fetch data", "OFFCHAIN_FAULT", {
          reason: "FETCH_FAILED",
          transaction,
          info: { data: error.data, errorArgs: ccipArgs.errorArgs }
        });
        const tx2 = {
          to: txSender,
          data: concat([ccipArgs.selector, encodeBytes([ccipResult, ccipArgs.extraData])])
        };
        this.emit("debug", { action: "sendCcipReadCall", transaction: tx2 });
        try {
          const result2 = await this.#call(tx2, blockTag, attempt + 1);
          this.emit("debug", { action: "receiveCcipReadCallResult", transaction: Object.assign({}, tx2), result: result2 });
          return result2;
        } catch (error2) {
          this.emit("debug", { action: "receiveCcipReadCallError", transaction: Object.assign({}, tx2), error: error2 });
          throw error2;
        }
      }
      throw error;
    }
  }
  async #checkNetwork(promise) {
    const { value } = await resolveProperties({
      network: this.getNetwork(),
      value: promise
    });
    return value;
  }
  async call(_tx) {
    const { tx, blockTag } = await resolveProperties({
      tx: this._getTransactionRequest(_tx),
      blockTag: this._getBlockTag(_tx.blockTag)
    });
    return await this.#checkNetwork(this.#call(tx, blockTag, _tx.enableCcipRead ? 0 : -1));
  }
  // Account
  async #getAccountValue(request, _address, _blockTag) {
    let address = this._getAddress(_address);
    let blockTag = this._getBlockTag(_blockTag);
    if (typeof address !== "string" || typeof blockTag !== "string") {
      [address, blockTag] = await Promise.all([address, blockTag]);
    }
    return await this.#checkNetwork(this.#perform(Object.assign(request, { address, blockTag })));
  }
  async getBalance(address, blockTag) {
    return getBigInt(await this.#getAccountValue({ method: "getBalance" }, address, blockTag), "%response");
  }
  async getTransactionCount(address, blockTag) {
    return getNumber(await this.#getAccountValue({ method: "getTransactionCount" }, address, blockTag), "%response");
  }
  async getCode(address, blockTag) {
    return hexlify(await this.#getAccountValue({ method: "getCode" }, address, blockTag));
  }
  async getStorage(address, _position, blockTag) {
    const position = getBigInt(_position, "position");
    return hexlify(await this.#getAccountValue({ method: "getStorage", position }, address, blockTag));
  }
  // Write
  async broadcastTransaction(signedTx) {
    const { blockNumber, hash: hash2, network } = await resolveProperties({
      blockNumber: this.getBlockNumber(),
      hash: this._perform({
        method: "broadcastTransaction",
        signedTransaction: signedTx
      }),
      network: this.getNetwork()
    });
    const tx = Transaction.from(signedTx);
    if (tx.hash !== hash2) {
      throw new Error("@TODO: the returned hash did not match");
    }
    return this._wrapTransactionResponse(tx, network).replaceableTransaction(blockNumber);
  }
  async #getBlock(block, includeTransactions) {
    if (isHexString(block, 32)) {
      return await this.#perform({
        method: "getBlock",
        blockHash: block,
        includeTransactions
      });
    }
    let blockTag = this._getBlockTag(block);
    if (typeof blockTag !== "string") {
      blockTag = await blockTag;
    }
    return await this.#perform({
      method: "getBlock",
      blockTag,
      includeTransactions
    });
  }
  // Queries
  async getBlock(block, prefetchTxs) {
    const { network, params } = await resolveProperties({
      network: this.getNetwork(),
      params: this.#getBlock(block, !!prefetchTxs)
    });
    if (params == null) {
      return null;
    }
    return this._wrapBlock(params, network);
  }
  async getTransaction(hash2) {
    const { network, params } = await resolveProperties({
      network: this.getNetwork(),
      params: this.#perform({ method: "getTransaction", hash: hash2 })
    });
    if (params == null) {
      return null;
    }
    return this._wrapTransactionResponse(params, network);
  }
  async getTransactionReceipt(hash2) {
    const { network, params } = await resolveProperties({
      network: this.getNetwork(),
      params: this.#perform({ method: "getTransactionReceipt", hash: hash2 })
    });
    if (params == null) {
      return null;
    }
    if (params.gasPrice == null && params.effectiveGasPrice == null) {
      const tx = await this.#perform({ method: "getTransaction", hash: hash2 });
      if (tx == null) {
        throw new Error("report this; could not find tx or effectiveGasPrice");
      }
      params.effectiveGasPrice = tx.gasPrice;
    }
    return this._wrapTransactionReceipt(params, network);
  }
  async getTransactionResult(hash2) {
    const { result: result2 } = await resolveProperties({
      network: this.getNetwork(),
      result: this.#perform({ method: "getTransactionResult", hash: hash2 })
    });
    if (result2 == null) {
      return null;
    }
    return hexlify(result2);
  }
  // Bloom-filter Queries
  async getLogs(_filter) {
    let filter = this._getFilter(_filter);
    if (isPromise(filter)) {
      filter = await filter;
    }
    const { network, params } = await resolveProperties({
      network: this.getNetwork(),
      params: this.#perform({ method: "getLogs", filter })
    });
    return params.map((p) => this._wrapLog(p, network));
  }
  // ENS
  _getProvider(chainId) {
    assert(false, "provider cannot connect to target network", "UNSUPPORTED_OPERATION", {
      operation: "_getProvider()"
    });
  }
  async getResolver(name) {
    return await EnsResolver.fromName(this, name);
  }
  async getAvatar(name) {
    const resolver = await this.getResolver(name);
    if (resolver) {
      return await resolver.getAvatar();
    }
    return null;
  }
  async resolveName(name, coinType) {
    const resolver = await this.getResolver(name);
    if (resolver) {
      return await resolver.getAddress(coinType);
    }
    return null;
  }
  async lookupAddress(address, coinType) {
    return await EnsResolver.lookupAddress(this, address, coinType);
  }
  async waitForTransaction(hash2, _confirms, timeout) {
    const confirms = _confirms != null ? _confirms : 1;
    if (confirms === 0) {
      return this.getTransactionReceipt(hash2);
    }
    return new Promise(async (resolve, reject) => {
      let timer = null;
      const listener = async (blockNumber) => {
        try {
          const receipt = await this.getTransactionReceipt(hash2);
          if (receipt != null) {
            if (blockNumber - receipt.blockNumber + 1 >= confirms) {
              resolve(receipt);
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
              return;
            }
          }
        } catch (error) {
          console.log("EEE", error);
        }
        this.once("block", listener);
      };
      if (timeout != null) {
        timer = setTimeout(() => {
          if (timer == null) {
            return;
          }
          timer = null;
          this.off("block", listener);
          reject(makeError("timeout", "TIMEOUT", { reason: "timeout" }));
        }, timeout);
      }
      listener(await this.getBlockNumber());
    });
  }
  async waitForBlock(blockTag) {
    assert(false, "not implemented yet", "NOT_IMPLEMENTED", {
      operation: "waitForBlock"
    });
  }
  /**
   *  Clear a timer created using the [[_setTimeout]] method.
   */
  _clearTimeout(timerId) {
    const timer = this.#timers.get(timerId);
    if (!timer) {
      return;
    }
    if (timer.timer) {
      clearTimeout(timer.timer);
    }
    this.#timers.delete(timerId);
  }
  /**
   *  Create a timer that will execute %%func%% after at least %%timeout%%
   *  (in ms). If %%timeout%% is unspecified, then %%func%% will execute
   *  in the next event loop.
   *
   *  [Pausing](AbstractProvider-paused) the provider will pause any
   *  associated timers.
   */
  _setTimeout(_func, timeout) {
    if (timeout == null) {
      timeout = 0;
    }
    const timerId = this.#nextTimer++;
    const func = () => {
      this.#timers.delete(timerId);
      _func();
    };
    if (this.paused) {
      this.#timers.set(timerId, { timer: null, func, time: timeout });
    } else {
      const timer = setTimeout(func, timeout);
      this.#timers.set(timerId, { timer, func, time: getTime2() });
    }
    return timerId;
  }
  /**
   *  Perform %%func%% on each subscriber.
   */
  _forEachSubscriber(func) {
    for (const sub of this.#subs.values()) {
      func(sub.subscriber);
    }
  }
  /**
   *  Sub-classes may override this to customize subscription
   *  implementations.
   */
  _getSubscriber(sub) {
    switch (sub.type) {
      case "debug":
      case "error":
      case "network":
        return new UnmanagedSubscriber(sub.type);
      case "block": {
        const subscriber = new PollingBlockSubscriber(this);
        subscriber.pollingInterval = this.pollingInterval;
        return subscriber;
      }
      case "safe":
      case "finalized":
        return new PollingBlockTagSubscriber(this, sub.type);
      case "event":
        return new PollingEventSubscriber(this, sub.filter);
      case "transaction":
        return new PollingTransactionSubscriber(this, sub.hash);
      case "orphan":
        return new PollingOrphanSubscriber(this, sub.filter);
    }
    throw new Error(`unsupported event: ${sub.type}`);
  }
  /**
   *  If a [[Subscriber]] fails and needs to replace itself, this
   *  method may be used.
   *
   *  For example, this is used for providers when using the
   *  ``eth_getFilterChanges`` method, which can return null if state
   *  filters are not supported by the backend, allowing the Subscriber
   *  to swap in a [[PollingEventSubscriber]].
   */
  _recoverSubscriber(oldSub, newSub) {
    for (const sub of this.#subs.values()) {
      if (sub.subscriber === oldSub) {
        if (sub.started) {
          sub.subscriber.stop();
        }
        sub.subscriber = newSub;
        if (sub.started) {
          newSub.start();
        }
        if (this.#pausedState != null) {
          newSub.pause(this.#pausedState);
        }
        break;
      }
    }
  }
  async #hasSub(event, emitArgs) {
    let sub = await getSubscription(event, this);
    if (sub.type === "event" && emitArgs && emitArgs.length > 0 && emitArgs[0].removed === true) {
      sub = await getSubscription({ orphan: "drop-log", log: emitArgs[0] }, this);
    }
    return this.#subs.get(sub.tag) || null;
  }
  async #getSub(event) {
    const subscription = await getSubscription(event, this);
    const tag = subscription.tag;
    let sub = this.#subs.get(tag);
    if (!sub) {
      const subscriber = this._getSubscriber(subscription);
      const addressableMap = /* @__PURE__ */ new WeakMap();
      const nameMap = /* @__PURE__ */ new Map();
      sub = { subscriber, tag, addressableMap, nameMap, started: false, listeners: [] };
      this.#subs.set(tag, sub);
    }
    return sub;
  }
  async on(event, listener) {
    const sub = await this.#getSub(event);
    sub.listeners.push({ listener, once: false });
    if (!sub.started) {
      sub.subscriber.start();
      sub.started = true;
      if (this.#pausedState != null) {
        sub.subscriber.pause(this.#pausedState);
      }
    }
    return this;
  }
  async once(event, listener) {
    const sub = await this.#getSub(event);
    sub.listeners.push({ listener, once: true });
    if (!sub.started) {
      sub.subscriber.start();
      sub.started = true;
      if (this.#pausedState != null) {
        sub.subscriber.pause(this.#pausedState);
      }
    }
    return this;
  }
  async emit(event, ...args) {
    const sub = await this.#hasSub(event, args);
    if (!sub || sub.listeners.length === 0) {
      return false;
    }
    ;
    const count = sub.listeners.length;
    sub.listeners = sub.listeners.filter(({ listener, once }) => {
      const payload = new EventPayload(this, once ? null : listener, event);
      try {
        listener.call(this, ...args, payload);
      } catch (error) {
      }
      return !once;
    });
    if (sub.listeners.length === 0) {
      if (sub.started) {
        sub.subscriber.stop();
      }
      this.#subs.delete(sub.tag);
    }
    return count > 0;
  }
  async listenerCount(event) {
    if (event) {
      const sub = await this.#hasSub(event);
      if (!sub) {
        return 0;
      }
      return sub.listeners.length;
    }
    let total = 0;
    for (const { listeners } of this.#subs.values()) {
      total += listeners.length;
    }
    return total;
  }
  async listeners(event) {
    if (event) {
      const sub = await this.#hasSub(event);
      if (!sub) {
        return [];
      }
      return sub.listeners.map(({ listener }) => listener);
    }
    let result2 = [];
    for (const { listeners } of this.#subs.values()) {
      result2 = result2.concat(listeners.map(({ listener }) => listener));
    }
    return result2;
  }
  async off(event, listener) {
    const sub = await this.#hasSub(event);
    if (!sub) {
      return this;
    }
    if (listener) {
      const index = sub.listeners.map(({ listener: listener2 }) => listener2).indexOf(listener);
      if (index >= 0) {
        sub.listeners.splice(index, 1);
      }
    }
    if (!listener || sub.listeners.length === 0) {
      if (sub.started) {
        sub.subscriber.stop();
      }
      this.#subs.delete(sub.tag);
    }
    return this;
  }
  async removeAllListeners(event) {
    if (event) {
      const { tag, started, subscriber } = await this.#getSub(event);
      if (started) {
        subscriber.stop();
      }
      this.#subs.delete(tag);
    } else {
      for (const [tag, { started, subscriber }] of this.#subs) {
        if (started) {
          subscriber.stop();
        }
        this.#subs.delete(tag);
      }
    }
    return this;
  }
  // Alias for "on"
  async addListener(event, listener) {
    return await this.on(event, listener);
  }
  // Alias for "off"
  async removeListener(event, listener) {
    return this.off(event, listener);
  }
  /**
   *  If this provider has been destroyed using the [[destroy]] method.
   *
   *  Once destroyed, all resources are reclaimed, internal event loops
   *  and timers are cleaned up and no further requests may be sent to
   *  the provider.
   */
  get destroyed() {
    return this.#destroyed;
  }
  /**
   *  Sub-classes may use this to shutdown any sockets or release their
   *  resources and reject any pending requests.
   *
   *  Sub-classes **must** call ``super.destroy()``.
   */
  destroy() {
    this.removeAllListeners();
    for (const timerId of this.#timers.keys()) {
      this._clearTimeout(timerId);
    }
    this.#destroyed = true;
  }
  /**
   *  Whether the provider is currently paused.
   *
   *  A paused provider will not emit any events, and generally should
   *  not make any requests to the network, but that is up to sub-classes
   *  to manage.
   *
   *  Setting ``paused = true`` is identical to calling ``.pause(false)``,
   *  which will buffer any events that occur while paused until the
   *  provider is unpaused.
   */
  get paused() {
    return this.#pausedState != null;
  }
  set paused(pause) {
    if (!!pause === this.paused) {
      return;
    }
    if (this.paused) {
      this.resume();
    } else {
      this.pause(false);
    }
  }
  /**
   *  Pause the provider. If %%dropWhilePaused%%, any events that occur
   *  while paused are dropped, otherwise all events will be emitted once
   *  the provider is unpaused.
   */
  pause(dropWhilePaused) {
    this.#lastBlockNumber = -1;
    if (this.#pausedState != null) {
      if (this.#pausedState == !!dropWhilePaused) {
        return;
      }
      assert(false, "cannot change pause type; resume first", "UNSUPPORTED_OPERATION", {
        operation: "pause"
      });
    }
    this._forEachSubscriber((s) => s.pause(dropWhilePaused));
    this.#pausedState = !!dropWhilePaused;
    for (const timer of this.#timers.values()) {
      if (timer.timer) {
        clearTimeout(timer.timer);
      }
      timer.time = getTime2() - timer.time;
    }
  }
  /**
   *  Resume the provider.
   */
  resume() {
    if (this.#pausedState == null) {
      return;
    }
    this._forEachSubscriber((s) => s.resume());
    this.#pausedState = null;
    for (const timer of this.#timers.values()) {
      let timeout = timer.time;
      if (timeout < 0) {
        timeout = 0;
      }
      timer.time = getTime2();
      setTimeout(timer.func, timeout);
    }
  }
};
function _parseString(result2, start) {
  try {
    const bytes2 = _parseBytes(result2, start);
    if (bytes2) {
      return toUtf8String(bytes2);
    }
  } catch (error) {
  }
  return null;
}
function _parseBytes(result2, start) {
  if (result2 === "0x") {
    return null;
  }
  try {
    const offset = getNumber(dataSlice(result2, start, start + 32));
    const length = getNumber(dataSlice(result2, offset, offset + 32));
    return dataSlice(result2, offset + 32, offset + 32 + length);
  } catch (error) {
  }
  return null;
}
function numPad(value) {
  const result2 = toBeArray(value);
  if (result2.length > 32) {
    throw new Error("internal; should not happen");
  }
  const padded = new Uint8Array(32);
  padded.set(result2, 32 - result2.length);
  return padded;
}
function bytesPad(value) {
  if (value.length % 32 === 0) {
    return value;
  }
  const result2 = new Uint8Array(Math.ceil(value.length / 32) * 32);
  result2.set(value);
  return result2;
}
var empty = new Uint8Array([]);
function encodeBytes(datas) {
  const result2 = [];
  let byteCount = 0;
  for (let i = 0; i < datas.length; i++) {
    result2.push(empty);
    byteCount += 32;
  }
  for (let i = 0; i < datas.length; i++) {
    const data = getBytes(datas[i]);
    result2[i] = numPad(byteCount);
    result2.push(numPad(data.length));
    result2.push(bytesPad(data));
    byteCount += 32 + Math.ceil(data.length / 32) * 32;
  }
  return concat(result2);
}
var zeros = "0x0000000000000000000000000000000000000000000000000000000000000000";
function parseOffchainLookup(data) {
  const result2 = {
    sender: "",
    urls: [],
    calldata: "",
    selector: "",
    extraData: "",
    errorArgs: []
  };
  assert(dataLength(data) >= 5 * 32, "insufficient OffchainLookup data", "OFFCHAIN_FAULT", {
    reason: "insufficient OffchainLookup data"
  });
  const sender = dataSlice(data, 0, 32);
  assert(dataSlice(sender, 0, 12) === dataSlice(zeros, 0, 12), "corrupt OffchainLookup sender", "OFFCHAIN_FAULT", {
    reason: "corrupt OffchainLookup sender"
  });
  result2.sender = dataSlice(sender, 12);
  try {
    const urls = [];
    const urlsOffset = getNumber(dataSlice(data, 32, 64));
    const urlsLength = getNumber(dataSlice(data, urlsOffset, urlsOffset + 32));
    const urlsData = dataSlice(data, urlsOffset + 32);
    for (let u = 0; u < urlsLength; u++) {
      const url = _parseString(urlsData, u * 32);
      if (url == null) {
        throw new Error("abort");
      }
      urls.push(url);
    }
    result2.urls = urls;
  } catch (error) {
    assert(false, "corrupt OffchainLookup urls", "OFFCHAIN_FAULT", {
      reason: "corrupt OffchainLookup urls"
    });
  }
  try {
    const calldata = _parseBytes(data, 64);
    if (calldata == null) {
      throw new Error("abort");
    }
    result2.calldata = calldata;
  } catch (error) {
    assert(false, "corrupt OffchainLookup calldata", "OFFCHAIN_FAULT", {
      reason: "corrupt OffchainLookup calldata"
    });
  }
  assert(dataSlice(data, 100, 128) === dataSlice(zeros, 0, 28), "corrupt OffchainLookup callbaackSelector", "OFFCHAIN_FAULT", {
    reason: "corrupt OffchainLookup callbaackSelector"
  });
  result2.selector = dataSlice(data, 96, 100);
  try {
    const extraData = _parseBytes(data, 128);
    if (extraData == null) {
      throw new Error("abort");
    }
    result2.extraData = extraData;
  } catch (error) {
    assert(false, "corrupt OffchainLookup extraData", "OFFCHAIN_FAULT", {
      reason: "corrupt OffchainLookup extraData"
    });
  }
  result2.errorArgs = "sender,urls,calldata,selector,extraData".split(/,/).map((k) => result2[k]);
  return result2;
}

// node_modules/ethers/lib.esm/providers/abstract-signer.js
function checkProvider(signer, operation) {
  if (signer.provider) {
    return signer.provider;
  }
  assert(false, "missing provider", "UNSUPPORTED_OPERATION", { operation });
}
async function populate(signer, tx) {
  let pop = copyRequest(tx);
  if (pop.to != null) {
    pop.to = resolveAddress(pop.to, signer);
  }
  if (pop.from != null) {
    const from = pop.from;
    pop.from = Promise.all([
      signer.getAddress(),
      resolveAddress(from, signer)
    ]).then(([address, from2]) => {
      assertArgument(address.toLowerCase() === from2.toLowerCase(), "transaction from mismatch", "tx.from", from2);
      return address;
    });
  } else {
    pop.from = signer.getAddress();
  }
  return await resolveProperties(pop);
}
var AbstractSigner = class {
  /**
   *  The provider this signer is connected to.
   */
  provider;
  /**
   *  Creates a new Signer connected to %%provider%%.
   */
  constructor(provider) {
    defineProperties(this, { provider: provider || null });
  }
  async getNonce(blockTag) {
    return checkProvider(this, "getTransactionCount").getTransactionCount(await this.getAddress(), blockTag);
  }
  async populateCall(tx) {
    const pop = await populate(this, tx);
    return pop;
  }
  async populateTransaction(tx) {
    const provider = checkProvider(this, "populateTransaction");
    const pop = await populate(this, tx);
    if (pop.nonce == null) {
      pop.nonce = await this.getNonce("pending");
    }
    if (pop.gasLimit == null) {
      pop.gasLimit = await this.estimateGas(pop);
    }
    const network = await this.provider.getNetwork();
    if (pop.chainId != null) {
      const chainId = getBigInt(pop.chainId);
      assertArgument(chainId === network.chainId, "transaction chainId mismatch", "tx.chainId", tx.chainId);
    } else {
      pop.chainId = network.chainId;
    }
    const hasEip1559 = pop.maxFeePerGas != null || pop.maxPriorityFeePerGas != null;
    if (pop.gasPrice != null && (pop.type === 2 || hasEip1559)) {
      assertArgument(false, "eip-1559 transaction do not support gasPrice", "tx", tx);
    } else if ((pop.type === 0 || pop.type === 1) && hasEip1559) {
      assertArgument(false, "pre-eip-1559 transaction do not support maxFeePerGas/maxPriorityFeePerGas", "tx", tx);
    }
    if ((pop.type === 2 || pop.type == null) && (pop.maxFeePerGas != null && pop.maxPriorityFeePerGas != null)) {
      pop.type = 2;
    } else if (pop.type === 0 || pop.type === 1) {
      const feeData = await provider.getFeeData();
      assert(feeData.gasPrice != null, "network does not support gasPrice", "UNSUPPORTED_OPERATION", {
        operation: "getGasPrice"
      });
      if (pop.gasPrice == null) {
        pop.gasPrice = feeData.gasPrice;
      }
    } else {
      const feeData = await provider.getFeeData();
      if (pop.type == null) {
        if (feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null) {
          if (pop.authorizationList && pop.authorizationList.length) {
            pop.type = 4;
          } else {
            pop.type = 2;
          }
          if (pop.gasPrice != null) {
            const gasPrice = pop.gasPrice;
            delete pop.gasPrice;
            pop.maxFeePerGas = gasPrice;
            pop.maxPriorityFeePerGas = gasPrice;
          } else {
            if (pop.maxFeePerGas == null) {
              pop.maxFeePerGas = feeData.maxFeePerGas;
            }
            if (pop.maxPriorityFeePerGas == null) {
              pop.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
            }
          }
        } else if (feeData.gasPrice != null) {
          assert(!hasEip1559, "network does not support EIP-1559", "UNSUPPORTED_OPERATION", {
            operation: "populateTransaction"
          });
          if (pop.gasPrice == null) {
            pop.gasPrice = feeData.gasPrice;
          }
          pop.type = 0;
        } else {
          assert(false, "failed to get consistent fee data", "UNSUPPORTED_OPERATION", {
            operation: "signer.getFeeData"
          });
        }
      } else if (pop.type === 2 || pop.type === 3 || pop.type === 4) {
        if (pop.maxFeePerGas == null) {
          pop.maxFeePerGas = feeData.maxFeePerGas;
        }
        if (pop.maxPriorityFeePerGas == null) {
          pop.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        }
      }
    }
    return await resolveProperties(pop);
  }
  async populateAuthorization(_auth) {
    const auth = Object.assign({}, _auth);
    if (auth.chainId == null) {
      auth.chainId = (await checkProvider(this, "getNetwork").getNetwork()).chainId;
    }
    if (auth.nonce == null) {
      auth.nonce = await this.getNonce();
    }
    return auth;
  }
  async estimateGas(tx) {
    return checkProvider(this, "estimateGas").estimateGas(await this.populateCall(tx));
  }
  async call(tx) {
    return checkProvider(this, "call").call(await this.populateCall(tx));
  }
  async resolveName(name) {
    const provider = checkProvider(this, "resolveName");
    return await provider.resolveName(name);
  }
  async sendTransaction(tx) {
    const provider = checkProvider(this, "sendTransaction");
    const pop = await this.populateTransaction(tx);
    delete pop.from;
    const txObj = Transaction.from(pop);
    return await provider.broadcastTransaction(await this.signTransaction(txObj));
  }
  // @TODO: in v7 move this to be abstract
  authorize(authorization) {
    assert(false, "authorization not implemented for this signer", "UNSUPPORTED_OPERATION", { operation: "authorize" });
  }
};
var VoidSigner = class _VoidSigner extends AbstractSigner {
  /**
   *  The signer address.
   */
  address;
  /**
   *  Creates a new **VoidSigner** with %%address%% attached to
   *  %%provider%%.
   */
  constructor(address, provider) {
    super(provider);
    defineProperties(this, { address });
  }
  async getAddress() {
    return this.address;
  }
  connect(provider) {
    return new _VoidSigner(this.address, provider);
  }
  #throwUnsupported(suffix, operation) {
    assert(false, `VoidSigner cannot sign ${suffix}`, "UNSUPPORTED_OPERATION", { operation });
  }
  async signTransaction(tx) {
    this.#throwUnsupported("transactions", "signTransaction");
  }
  async signMessage(message) {
    this.#throwUnsupported("messages", "signMessage");
  }
  async signTypedData(domain, types, value) {
    this.#throwUnsupported("typed-data", "signTypedData");
  }
};

// node_modules/ethers/lib.esm/providers/subscriber-filterid.js
function copy3(obj) {
  return JSON.parse(JSON.stringify(obj));
}
var FilterIdSubscriber = class {
  #provider;
  #filterIdPromise;
  #poller;
  #running;
  #network;
  #hault;
  /**
   *  Creates a new **FilterIdSubscriber** which will used [[_subscribe]]
   *  and [[_emitResults]] to setup the subscription and provide the event
   *  to the %%provider%%.
   */
  constructor(provider) {
    this.#provider = provider;
    this.#filterIdPromise = null;
    this.#poller = this.#poll.bind(this);
    this.#running = false;
    this.#network = null;
    this.#hault = false;
  }
  /**
   *  Sub-classes **must** override this to begin the subscription.
   */
  _subscribe(provider) {
    throw new Error("subclasses must override this");
  }
  /**
   *  Sub-classes **must** override this handle the events.
   */
  _emitResults(provider, result2) {
    throw new Error("subclasses must override this");
  }
  /**
   *  Sub-classes **must** override this handle recovery on errors.
   */
  _recover(provider) {
    throw new Error("subclasses must override this");
  }
  async #poll(blockNumber) {
    try {
      if (this.#filterIdPromise == null) {
        this.#filterIdPromise = this._subscribe(this.#provider);
      }
      let filterId = null;
      try {
        filterId = await this.#filterIdPromise;
      } catch (error) {
        if (!isError(error, "UNSUPPORTED_OPERATION") || error.operation !== "eth_newFilter") {
          throw error;
        }
      }
      if (filterId == null) {
        this.#filterIdPromise = null;
        this.#provider._recoverSubscriber(this, this._recover(this.#provider));
        return;
      }
      const network = await this.#provider.getNetwork();
      if (!this.#network) {
        this.#network = network;
      }
      if (this.#network.chainId !== network.chainId) {
        throw new Error("chaid changed");
      }
      if (this.#hault) {
        return;
      }
      const result2 = await this.#provider.send("eth_getFilterChanges", [filterId]);
      await this._emitResults(this.#provider, result2);
    } catch (error) {
      console.log("@TODO", error);
    }
    this.#provider.once("block", this.#poller);
  }
  #teardown() {
    const filterIdPromise = this.#filterIdPromise;
    if (filterIdPromise) {
      this.#filterIdPromise = null;
      filterIdPromise.then((filterId) => {
        if (this.#provider.destroyed) {
          return;
        }
        this.#provider.send("eth_uninstallFilter", [filterId]);
      });
    }
  }
  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#poll(-2);
  }
  stop() {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#hault = true;
    this.#teardown();
    this.#provider.off("block", this.#poller);
  }
  pause(dropWhilePaused) {
    if (dropWhilePaused) {
      this.#teardown();
    }
    this.#provider.off("block", this.#poller);
  }
  resume() {
    this.start();
  }
};
var FilterIdEventSubscriber = class extends FilterIdSubscriber {
  #event;
  /**
   *  Creates a new **FilterIdEventSubscriber** attached to %%provider%%
   *  listening for %%filter%%.
   */
  constructor(provider, filter) {
    super(provider);
    this.#event = copy3(filter);
  }
  _recover(provider) {
    return new PollingEventSubscriber(provider, this.#event);
  }
  async _subscribe(provider) {
    const filterId = await provider.send("eth_newFilter", [this.#event]);
    return filterId;
  }
  async _emitResults(provider, results) {
    for (const result2 of results) {
      provider.emit(this.#event, provider._wrapLog(result2, provider._network));
    }
  }
};
var FilterIdPendingSubscriber = class extends FilterIdSubscriber {
  async _subscribe(provider) {
    return await provider.send("eth_newPendingTransactionFilter", []);
  }
  async _emitResults(provider, results) {
    for (const result2 of results) {
      provider.emit("pending", result2);
    }
  }
};

// node_modules/ethers/lib.esm/providers/provider-jsonrpc.js
var Primitive = "bigint,boolean,function,number,string,symbol".split(/,/g);
function deepCopy(value) {
  if (value == null || Primitive.indexOf(typeof value) >= 0) {
    return value;
  }
  if (typeof value.getAddress === "function") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepCopy);
  }
  if (typeof value === "object") {
    return Object.keys(value).reduce((accum, key) => {
      accum[key] = value[key];
      return accum;
    }, {});
  }
  throw new Error(`should not happen: ${value} (${typeof value})`);
}
function stall2(duration) {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
}
function getLowerCase(value) {
  if (value) {
    return value.toLowerCase();
  }
  return value;
}
function isPollable(value) {
  return value && typeof value.pollingInterval === "number";
}
var defaultOptions2 = {
  polling: false,
  staticNetwork: null,
  batchStallTime: 10,
  batchMaxSize: 1 << 20,
  batchMaxCount: 100,
  cacheTimeout: 250,
  pollingInterval: 4e3
};
var JsonRpcSigner = class extends AbstractSigner {
  address;
  constructor(provider, address) {
    super(provider);
    address = getAddress(address);
    defineProperties(this, { address });
  }
  connect(provider) {
    assert(false, "cannot reconnect JsonRpcSigner", "UNSUPPORTED_OPERATION", {
      operation: "signer.connect"
    });
  }
  async getAddress() {
    return this.address;
  }
  // JSON-RPC will automatially fill in nonce, etc. so we just check from
  async populateTransaction(tx) {
    return await this.populateCall(tx);
  }
  // Returns just the hash of the transaction after sent, which is what
  // the bare JSON-RPC API does;
  async sendUncheckedTransaction(_tx) {
    const tx = deepCopy(_tx);
    const promises = [];
    if (tx.from) {
      const _from = tx.from;
      promises.push((async () => {
        const from = await resolveAddress(_from, this.provider);
        assertArgument(from != null && from.toLowerCase() === this.address.toLowerCase(), "from address mismatch", "transaction", _tx);
        tx.from = from;
      })());
    } else {
      tx.from = this.address;
    }
    if (tx.gasLimit == null) {
      promises.push((async () => {
        tx.gasLimit = await this.provider.estimateGas({ ...tx, from: this.address });
      })());
    }
    if (tx.to != null) {
      const _to = tx.to;
      promises.push((async () => {
        tx.to = await resolveAddress(_to, this.provider);
      })());
    }
    if (promises.length) {
      await Promise.all(promises);
    }
    const hexTx = this.provider.getRpcTransaction(tx);
    return this.provider.send("eth_sendTransaction", [hexTx]);
  }
  async sendTransaction(tx) {
    const blockNumber = await this.provider.getBlockNumber();
    const hash2 = await this.sendUncheckedTransaction(tx);
    return await new Promise((resolve, reject) => {
      const timeouts = [1e3, 100];
      let invalids = 0;
      const checkTx = async () => {
        try {
          const tx2 = await this.provider.getTransaction(hash2);
          if (tx2 != null) {
            resolve(tx2.replaceableTransaction(blockNumber));
            return;
          }
        } catch (error) {
          if (isError(error, "CANCELLED") || isError(error, "BAD_DATA") || isError(error, "NETWORK_ERROR") || isError(error, "UNSUPPORTED_OPERATION")) {
            if (error.info == null) {
              error.info = {};
            }
            error.info.sendTransactionHash = hash2;
            reject(error);
            return;
          }
          if (isError(error, "INVALID_ARGUMENT")) {
            invalids++;
            if (error.info == null) {
              error.info = {};
            }
            error.info.sendTransactionHash = hash2;
            if (invalids > 10) {
              reject(error);
              return;
            }
          }
          this.provider.emit("error", makeError("failed to fetch transation after sending (will try again)", "UNKNOWN_ERROR", { error }));
        }
        this.provider._setTimeout(() => {
          checkTx();
        }, timeouts.pop() || 4e3);
      };
      checkTx();
    });
  }
  async signTransaction(_tx) {
    const tx = deepCopy(_tx);
    if (tx.from) {
      const from = await resolveAddress(tx.from, this.provider);
      assertArgument(from != null && from.toLowerCase() === this.address.toLowerCase(), "from address mismatch", "transaction", _tx);
      tx.from = from;
    } else {
      tx.from = this.address;
    }
    const hexTx = this.provider.getRpcTransaction(tx);
    return await this.provider.send("eth_signTransaction", [hexTx]);
  }
  async signMessage(_message) {
    const message = typeof _message === "string" ? toUtf8Bytes(_message) : _message;
    return await this.provider.send("personal_sign", [
      hexlify(message),
      this.address.toLowerCase()
    ]);
  }
  async signTypedData(domain, types, _value) {
    const value = deepCopy(_value);
    const populated = await TypedDataEncoder.resolveNames(domain, types, value, async (value2) => {
      const address = await resolveAddress(value2);
      assertArgument(address != null, "TypedData does not support null address", "value", value2);
      return address;
    });
    return await this.provider.send("eth_signTypedData_v4", [
      this.address.toLowerCase(),
      JSON.stringify(TypedDataEncoder.getPayload(populated.domain, types, populated.value))
    ]);
  }
  async unlock(password) {
    return this.provider.send("personal_unlockAccount", [
      this.address.toLowerCase(),
      password,
      null
    ]);
  }
  // https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_sign
  async _legacySignMessage(_message) {
    const message = typeof _message === "string" ? toUtf8Bytes(_message) : _message;
    return await this.provider.send("eth_sign", [
      this.address.toLowerCase(),
      hexlify(message)
    ]);
  }
};
var JsonRpcApiProvider = class extends AbstractProvider {
  #options;
  // The next ID to use for the JSON-RPC ID field
  #nextId;
  // Payloads are queued and triggered in batches using the drainTimer
  #payloads;
  #drainTimer;
  #notReady;
  #network;
  #pendingDetectNetwork;
  #scheduleDrain() {
    if (this.#drainTimer) {
      return;
    }
    const stallTime = this._getOption("batchMaxCount") === 1 ? 0 : this._getOption("batchStallTime");
    this.#drainTimer = setTimeout(() => {
      this.#drainTimer = null;
      const payloads = this.#payloads;
      this.#payloads = [];
      while (payloads.length) {
        const batch = [payloads.shift()];
        while (payloads.length) {
          if (batch.length === this.#options.batchMaxCount) {
            break;
          }
          batch.push(payloads.shift());
          const bytes2 = JSON.stringify(batch.map((p) => p.payload));
          if (bytes2.length > this.#options.batchMaxSize) {
            payloads.unshift(batch.pop());
            break;
          }
        }
        (async () => {
          const payload = batch.length === 1 ? batch[0].payload : batch.map((p) => p.payload);
          this.emit("debug", { action: "sendRpcPayload", payload });
          try {
            const result2 = await this._send(payload);
            this.emit("debug", { action: "receiveRpcResult", result: result2 });
            for (const { resolve, reject, payload: payload2 } of batch) {
              if (this.destroyed) {
                reject(makeError("provider destroyed; cancelled request", "UNSUPPORTED_OPERATION", { operation: payload2.method }));
                continue;
              }
              const resp = result2.filter((r) => r.id === payload2.id)[0];
              if (resp == null) {
                const error = makeError("missing response for request", "BAD_DATA", {
                  value: result2,
                  info: { payload: payload2 }
                });
                this.emit("error", error);
                reject(error);
                continue;
              }
              if ("error" in resp) {
                reject(this.getRpcError(payload2, resp));
                continue;
              }
              resolve(resp.result);
            }
          } catch (error) {
            this.emit("debug", { action: "receiveRpcError", error });
            for (const { reject } of batch) {
              reject(error);
            }
          }
        })();
      }
    }, stallTime);
  }
  constructor(network, options2) {
    super(network, options2);
    this.#nextId = 1;
    this.#options = Object.assign({}, defaultOptions2, options2 || {});
    this.#payloads = [];
    this.#drainTimer = null;
    this.#network = null;
    this.#pendingDetectNetwork = null;
    {
      let resolve = null;
      const promise = new Promise((_resolve) => {
        resolve = _resolve;
      });
      this.#notReady = { promise, resolve };
    }
    const staticNetwork = this._getOption("staticNetwork");
    if (typeof staticNetwork === "boolean") {
      assertArgument(!staticNetwork || network !== "any", "staticNetwork cannot be used on special network 'any'", "options", options2);
      if (staticNetwork && network != null) {
        this.#network = Network.from(network);
      }
    } else if (staticNetwork) {
      assertArgument(network == null || staticNetwork.matches(network), "staticNetwork MUST match network object", "options", options2);
      this.#network = staticNetwork;
    }
  }
  /**
   *  Returns the value associated with the option %%key%%.
   *
   *  Sub-classes can use this to inquire about configuration options.
   */
  _getOption(key) {
    return this.#options[key];
  }
  /**
   *  Gets the [[Network]] this provider has committed to. On each call, the network
   *  is detected, and if it has changed, the call will reject.
   */
  get _network() {
    assert(this.#network, "network is not available yet", "NETWORK_ERROR");
    return this.#network;
  }
  /**
   *  Resolves to the non-normalized value by performing %%req%%.
   *
   *  Sub-classes may override this to modify behavior of actions,
   *  and should generally call ``super._perform`` as a fallback.
   */
  async _perform(req) {
    if (req.method === "call" || req.method === "estimateGas") {
      let tx = req.transaction;
      if (tx && tx.type != null && getBigInt(tx.type)) {
        if (tx.maxFeePerGas == null && tx.maxPriorityFeePerGas == null) {
          const feeData = await this.getFeeData();
          if (feeData.maxFeePerGas == null && feeData.maxPriorityFeePerGas == null) {
            req = Object.assign({}, req, {
              transaction: Object.assign({}, tx, { type: void 0 })
            });
          }
        }
      }
    }
    const request = this.getRpcRequest(req);
    if (request != null) {
      return await this.send(request.method, request.args);
    }
    return super._perform(req);
  }
  /**
   *  Sub-classes may override this; it detects the *actual* network that
   *  we are **currently** connected to.
   *
   *  Keep in mind that [[send]] may only be used once [[ready]], otherwise the
   *  _send primitive must be used instead.
   */
  async _detectNetwork() {
    const network = this._getOption("staticNetwork");
    if (network) {
      if (network === true) {
        if (this.#network) {
          return this.#network;
        }
      } else {
        return network;
      }
    }
    if (this.#pendingDetectNetwork) {
      return await this.#pendingDetectNetwork;
    }
    if (this.ready) {
      this.#pendingDetectNetwork = (async () => {
        try {
          const result2 = Network.from(getBigInt(await this.send("eth_chainId", [])));
          this.#pendingDetectNetwork = null;
          return result2;
        } catch (error) {
          this.#pendingDetectNetwork = null;
          throw error;
        }
      })();
      return await this.#pendingDetectNetwork;
    }
    this.#pendingDetectNetwork = (async () => {
      const payload = {
        id: this.#nextId++,
        method: "eth_chainId",
        params: [],
        jsonrpc: "2.0"
      };
      this.emit("debug", { action: "sendRpcPayload", payload });
      let result2;
      try {
        result2 = (await this._send(payload))[0];
        this.#pendingDetectNetwork = null;
      } catch (error) {
        this.#pendingDetectNetwork = null;
        this.emit("debug", { action: "receiveRpcError", error });
        throw error;
      }
      this.emit("debug", { action: "receiveRpcResult", result: result2 });
      if ("result" in result2) {
        return Network.from(getBigInt(result2.result));
      }
      throw this.getRpcError(payload, result2);
    })();
    return await this.#pendingDetectNetwork;
  }
  /**
   *  Sub-classes **MUST** call this. Until [[_start]] has been called, no calls
   *  will be passed to [[_send]] from [[send]]. If it is overridden, then
   *  ``super._start()`` **MUST** be called.
   *
   *  Calling it multiple times is safe and has no effect.
   */
  _start() {
    if (this.#notReady == null || this.#notReady.resolve == null) {
      return;
    }
    this.#notReady.resolve();
    this.#notReady = null;
    (async () => {
      while (this.#network == null && !this.destroyed) {
        try {
          this.#network = await this._detectNetwork();
        } catch (error) {
          if (this.destroyed) {
            break;
          }
          console.log("JsonRpcProvider failed to detect network and cannot start up; retry in 1s (perhaps the URL is wrong or the node is not started)");
          this.emit("error", makeError("failed to bootstrap network detection", "NETWORK_ERROR", { event: "initial-network-discovery", info: { error } }));
          await stall2(1e3);
        }
      }
      this.#scheduleDrain();
    })();
  }
  /**
   *  Resolves once the [[_start]] has been called. This can be used in
   *  sub-classes to defer sending data until the connection has been
   *  established.
   */
  async _waitUntilReady() {
    if (this.#notReady == null) {
      return;
    }
    return await this.#notReady.promise;
  }
  /**
   *  Return a Subscriber that will manage the %%sub%%.
   *
   *  Sub-classes may override this to modify the behavior of
   *  subscription management.
   */
  _getSubscriber(sub) {
    if (sub.type === "pending") {
      return new FilterIdPendingSubscriber(this);
    }
    if (sub.type === "event") {
      if (this._getOption("polling")) {
        return new PollingEventSubscriber(this, sub.filter);
      }
      return new FilterIdEventSubscriber(this, sub.filter);
    }
    if (sub.type === "orphan" && sub.filter.orphan === "drop-log") {
      return new UnmanagedSubscriber("orphan");
    }
    return super._getSubscriber(sub);
  }
  /**
   *  Returns true only if the [[_start]] has been called.
   */
  get ready() {
    return this.#notReady == null;
  }
  /**
   *  Returns %%tx%% as a normalized JSON-RPC transaction request,
   *  which has all values hexlified and any numeric values converted
   *  to Quantity values.
   */
  getRpcTransaction(tx) {
    const result2 = {};
    ["chainId", "gasLimit", "gasPrice", "type", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "value"].forEach((key) => {
      if (tx[key] == null) {
        return;
      }
      let dstKey = key;
      if (key === "gasLimit") {
        dstKey = "gas";
      }
      result2[dstKey] = toQuantity(getBigInt(tx[key], `tx.${key}`));
    });
    ["from", "to", "data"].forEach((key) => {
      if (tx[key] == null) {
        return;
      }
      result2[key] = hexlify(tx[key]);
    });
    if (tx.accessList) {
      result2["accessList"] = accessListify(tx.accessList);
    }
    if (tx.blobVersionedHashes) {
      result2["blobVersionedHashes"] = tx.blobVersionedHashes.map((h) => h.toLowerCase());
    }
    if (tx.authorizationList) {
      result2["authorizationList"] = tx.authorizationList.map((_a) => {
        const a = authorizationify(_a);
        return {
          address: a.address,
          nonce: toQuantity(a.nonce),
          chainId: toQuantity(a.chainId),
          yParity: toQuantity(a.signature.yParity),
          r: toQuantity(a.signature.r),
          s: toQuantity(a.signature.s)
        };
      });
    }
    return result2;
  }
  /**
   *  Returns the request method and arguments required to perform
   *  %%req%%.
   */
  getRpcRequest(req) {
    switch (req.method) {
      case "chainId":
        return { method: "eth_chainId", args: [] };
      case "getBlockNumber":
        return { method: "eth_blockNumber", args: [] };
      case "getGasPrice":
        return { method: "eth_gasPrice", args: [] };
      case "getPriorityFee":
        return { method: "eth_maxPriorityFeePerGas", args: [] };
      case "getBalance":
        return {
          method: "eth_getBalance",
          args: [getLowerCase(req.address), req.blockTag]
        };
      case "getTransactionCount":
        return {
          method: "eth_getTransactionCount",
          args: [getLowerCase(req.address), req.blockTag]
        };
      case "getCode":
        return {
          method: "eth_getCode",
          args: [getLowerCase(req.address), req.blockTag]
        };
      case "getStorage":
        return {
          method: "eth_getStorageAt",
          args: [
            getLowerCase(req.address),
            "0x" + req.position.toString(16),
            req.blockTag
          ]
        };
      case "broadcastTransaction":
        return {
          method: "eth_sendRawTransaction",
          args: [req.signedTransaction]
        };
      case "getBlock":
        if ("blockTag" in req) {
          return {
            method: "eth_getBlockByNumber",
            args: [req.blockTag, !!req.includeTransactions]
          };
        } else if ("blockHash" in req) {
          return {
            method: "eth_getBlockByHash",
            args: [req.blockHash, !!req.includeTransactions]
          };
        }
        break;
      case "getTransaction":
        return {
          method: "eth_getTransactionByHash",
          args: [req.hash]
        };
      case "getTransactionReceipt":
        return {
          method: "eth_getTransactionReceipt",
          args: [req.hash]
        };
      case "call":
        return {
          method: "eth_call",
          args: [this.getRpcTransaction(req.transaction), req.blockTag]
        };
      case "estimateGas": {
        return {
          method: "eth_estimateGas",
          args: [this.getRpcTransaction(req.transaction)]
        };
      }
      case "getLogs":
        if (req.filter && req.filter.address != null) {
          if (Array.isArray(req.filter.address)) {
            req.filter.address = req.filter.address.map(getLowerCase);
          } else {
            req.filter.address = getLowerCase(req.filter.address);
          }
        }
        return { method: "eth_getLogs", args: [req.filter] };
    }
    return null;
  }
  /**
   *  Returns an ethers-style Error for the given JSON-RPC error
   *  %%payload%%, coalescing the various strings and error shapes
   *  that different nodes return, coercing them into a machine-readable
   *  standardized error.
   */
  getRpcError(payload, _error) {
    const { method } = payload;
    const { error } = _error;
    if (method === "eth_estimateGas" && error.message) {
      const msg = error.message;
      if (!msg.match(/revert/i) && msg.match(/insufficient funds/i)) {
        return makeError("insufficient funds", "INSUFFICIENT_FUNDS", {
          transaction: payload.params[0],
          info: { payload, error }
        });
      } else if (msg.match(/nonce/i) && msg.match(/too low/i)) {
        return makeError("nonce has already been used", "NONCE_EXPIRED", {
          transaction: payload.params[0],
          info: { payload, error }
        });
      }
    }
    if (method === "eth_call" || method === "eth_estimateGas") {
      const result2 = spelunkData(error);
      const e = AbiCoder.getBuiltinCallException(method === "eth_call" ? "call" : "estimateGas", payload.params[0], result2 ? result2.data : null);
      e.info = { error, payload };
      return e;
    }
    const message = JSON.stringify(spelunkMessage(error));
    if (typeof error.message === "string" && error.message.match(/user denied|ethers-user-denied/i)) {
      const actionMap = {
        eth_sign: "signMessage",
        personal_sign: "signMessage",
        eth_signTypedData_v4: "signTypedData",
        eth_signTransaction: "signTransaction",
        eth_sendTransaction: "sendTransaction",
        eth_requestAccounts: "requestAccess",
        wallet_requestAccounts: "requestAccess"
      };
      return makeError(`user rejected action`, "ACTION_REJECTED", {
        action: actionMap[method] || "unknown",
        reason: "rejected",
        info: { payload, error }
      });
    }
    if (method === "eth_sendRawTransaction" || method === "eth_sendTransaction") {
      const transaction = payload.params[0];
      if (message.match(/insufficient funds|base fee exceeds gas limit/i)) {
        return makeError("insufficient funds for intrinsic transaction cost", "INSUFFICIENT_FUNDS", {
          transaction,
          info: { error }
        });
      }
      if (message.match(/nonce/i) && message.match(/too low/i)) {
        return makeError("nonce has already been used", "NONCE_EXPIRED", { transaction, info: { error } });
      }
      if (message.match(/replacement transaction/i) && message.match(/underpriced/i)) {
        return makeError("replacement fee too low", "REPLACEMENT_UNDERPRICED", { transaction, info: { error } });
      }
      if (message.match(/only replay-protected/i)) {
        return makeError("legacy pre-eip-155 transactions not supported", "UNSUPPORTED_OPERATION", {
          operation: method,
          info: { transaction, info: { error } }
        });
      }
    }
    let unsupported = !!message.match(/the method .* does not exist/i);
    if (!unsupported) {
      if (error && error.details && error.details.startsWith("Unauthorized method:")) {
        unsupported = true;
      }
    }
    if (unsupported) {
      return makeError("unsupported operation", "UNSUPPORTED_OPERATION", {
        operation: payload.method,
        info: { error, payload }
      });
    }
    return makeError("could not coalesce error", "UNKNOWN_ERROR", { error, payload });
  }
  /**
   *  Requests the %%method%% with %%params%% via the JSON-RPC protocol
   *  over the underlying channel. This can be used to call methods
   *  on the backend that do not have a high-level API within the Provider
   *  API.
   *
   *  This method queues requests according to the batch constraints
   *  in the options, assigns the request a unique ID.
   *
   *  **Do NOT override** this method in sub-classes; instead
   *  override [[_send]] or force the options values in the
   *  call to the constructor to modify this method's behavior.
   */
  send(method, params) {
    if (this.destroyed) {
      return Promise.reject(makeError("provider destroyed; cancelled request", "UNSUPPORTED_OPERATION", { operation: method }));
    }
    const id2 = this.#nextId++;
    const promise = new Promise((resolve, reject) => {
      this.#payloads.push({
        resolve,
        reject,
        payload: { method, params, id: id2, jsonrpc: "2.0" }
      });
    });
    this.#scheduleDrain();
    return promise;
  }
  /**
   *  Resolves to the [[Signer]] account for  %%address%% managed by
   *  the client.
   *
   *  If the %%address%% is a number, it is used as an index in the
   *  the accounts from [[listAccounts]].
   *
   *  This can only be used on clients which manage accounts (such as
   *  Geth with imported account or MetaMask).
   *
   *  Throws if the account doesn't exist.
   */
  async getSigner(address) {
    if (address == null) {
      address = 0;
    }
    const accountsPromise = this.send("eth_accounts", []);
    if (typeof address === "number") {
      const accounts2 = await accountsPromise;
      if (address >= accounts2.length) {
        throw new Error("no such account");
      }
      return new JsonRpcSigner(this, accounts2[address]);
    }
    const { accounts } = await resolveProperties({
      network: this.getNetwork(),
      accounts: accountsPromise
    });
    address = getAddress(address);
    for (const account of accounts) {
      if (getAddress(account) === address) {
        return new JsonRpcSigner(this, address);
      }
    }
    throw new Error("invalid account");
  }
  async listAccounts() {
    const accounts = await this.send("eth_accounts", []);
    return accounts.map((a) => new JsonRpcSigner(this, a));
  }
  destroy() {
    if (this.#drainTimer) {
      clearTimeout(this.#drainTimer);
      this.#drainTimer = null;
    }
    for (const { payload, reject } of this.#payloads) {
      reject(makeError("provider destroyed; cancelled request", "UNSUPPORTED_OPERATION", { operation: payload.method }));
    }
    this.#payloads = [];
    super.destroy();
  }
};
var JsonRpcApiPollingProvider = class extends JsonRpcApiProvider {
  #pollingInterval;
  constructor(network, options2) {
    super(network, options2);
    let pollingInterval = this._getOption("pollingInterval");
    if (pollingInterval == null) {
      pollingInterval = defaultOptions2.pollingInterval;
    }
    this.#pollingInterval = pollingInterval;
  }
  _getSubscriber(sub) {
    const subscriber = super._getSubscriber(sub);
    if (isPollable(subscriber)) {
      subscriber.pollingInterval = this.#pollingInterval;
    }
    return subscriber;
  }
  /**
   *  The polling interval (default: 4000 ms)
   */
  get pollingInterval() {
    return this.#pollingInterval;
  }
  set pollingInterval(value) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("invalid interval");
    }
    this.#pollingInterval = value;
    this._forEachSubscriber((sub) => {
      if (isPollable(sub)) {
        sub.pollingInterval = this.#pollingInterval;
      }
    });
  }
};
var JsonRpcProvider = class extends JsonRpcApiPollingProvider {
  #connect;
  constructor(url, network, options2) {
    if (url == null) {
      url = "http://localhost:8545";
    }
    super(network, options2);
    if (typeof url === "string") {
      this.#connect = new FetchRequest(url);
    } else {
      this.#connect = url.clone();
    }
  }
  _getConnection() {
    return this.#connect.clone();
  }
  async send(method, params) {
    await this._start();
    return await super.send(method, params);
  }
  async _send(payload) {
    const request = this._getConnection();
    request.body = JSON.stringify(payload);
    request.setHeader("content-type", "application/json");
    const response = await request.send();
    response.assertOk();
    let resp = response.bodyJson;
    if (!Array.isArray(resp)) {
      resp = [resp];
    }
    return resp;
  }
};
function spelunkData(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.message === "string" && value.message.match(/revert/i) && isHexString(value.data)) {
    return { message: value.message, data: value.data };
  }
  if (typeof value === "object") {
    for (const key in value) {
      const result2 = spelunkData(value[key]);
      if (result2) {
        return result2;
      }
    }
    return null;
  }
  if (typeof value === "string") {
    try {
      return spelunkData(JSON.parse(value));
    } catch (error) {
    }
  }
  return null;
}
function _spelunkMessage(value, result2) {
  if (value == null) {
    return;
  }
  if (typeof value.message === "string") {
    result2.push(value.message);
  }
  if (typeof value === "object") {
    for (const key in value) {
      _spelunkMessage(value[key], result2);
    }
  }
  if (typeof value === "string") {
    try {
      return _spelunkMessage(JSON.parse(value), result2);
    } catch (error) {
    }
  }
}
function spelunkMessage(value) {
  const result2 = [];
  _spelunkMessage(value, result2);
  return result2;
}

// node_modules/ethers/lib.esm/wallet/base-wallet.js
var BaseWallet = class _BaseWallet extends AbstractSigner {
  /**
   *  The wallet address.
   */
  address;
  #signingKey;
  /**
   *  Creates a new BaseWallet for %%privateKey%%, optionally
   *  connected to %%provider%%.
   *
   *  If %%provider%% is not specified, only offline methods can
   *  be used.
   */
  constructor(privateKey, provider) {
    super(provider);
    assertArgument(privateKey && typeof privateKey.sign === "function", "invalid private key", "privateKey", "[ REDACTED ]");
    this.#signingKey = privateKey;
    const address = computeAddress(this.signingKey.publicKey);
    defineProperties(this, { address });
  }
  // Store private values behind getters to reduce visibility
  // in console.log
  /**
   *  The [[SigningKey]] used for signing payloads.
   */
  get signingKey() {
    return this.#signingKey;
  }
  /**
   *  The private key for this wallet.
   */
  get privateKey() {
    return this.signingKey.privateKey;
  }
  async getAddress() {
    return this.address;
  }
  connect(provider) {
    return new _BaseWallet(this.#signingKey, provider);
  }
  async signTransaction(tx) {
    tx = copyRequest(tx);
    const { to, from } = await resolveProperties({
      to: tx.to ? resolveAddress(tx.to, this) : void 0,
      from: tx.from ? resolveAddress(tx.from, this) : void 0
    });
    if (to != null) {
      tx.to = to;
    }
    if (from != null) {
      tx.from = from;
    }
    if (tx.from != null) {
      assertArgument(getAddress(tx.from) === this.address, "transaction from address mismatch", "tx.from", tx.from);
      delete tx.from;
    }
    const btx = Transaction.from(tx);
    btx.signature = this.signingKey.sign(btx.unsignedHash);
    return btx.serialized;
  }
  async signMessage(message) {
    return this.signMessageSync(message);
  }
  // @TODO: Add a secialized signTx and signTyped sync that enforces
  // all parameters are known?
  /**
   *  Returns the signature for %%message%% signed with this wallet.
   */
  signMessageSync(message) {
    return this.signingKey.sign(hashMessage(message)).serialized;
  }
  /**
   *  Returns the Authorization for %%auth%%.
   */
  authorizeSync(auth) {
    assertArgument(typeof auth.address === "string", "invalid address for authorizeSync", "auth.address", auth);
    const signature = this.signingKey.sign(hashAuthorization(auth));
    return Object.assign({}, {
      address: getAddress(auth.address),
      nonce: getBigInt(auth.nonce || 0),
      chainId: getBigInt(auth.chainId || 0)
    }, { signature });
  }
  /**
   *  Resolves to the Authorization for %%auth%%.
   */
  async authorize(auth) {
    auth = Object.assign({}, auth, {
      address: await resolveAddress(auth.address, this)
    });
    return this.authorizeSync(await this.populateAuthorization(auth));
  }
  async signTypedData(domain, types, value) {
    const populated = await TypedDataEncoder.resolveNames(domain, types, value, async (name) => {
      assert(this.provider != null, "cannot resolve ENS names without a provider", "UNSUPPORTED_OPERATION", {
        operation: "resolveName",
        info: { name }
      });
      const address = await this.provider.resolveName(name);
      assert(address != null, "unconfigured ENS name", "UNCONFIGURED_NAME", {
        value: name
      });
      return address;
    });
    return this.signingKey.sign(TypedDataEncoder.hash(populated.domain, types, populated.value)).serialized;
  }
};

// node_modules/ethers/lib.esm/wordlists/decode-owl.js
var subsChrs = " !#$%&'()*+,-./<=>?@[]^_`{|}~";
var Word = /^[a-z]*$/i;
function unfold(words2, sep) {
  let initial = 97;
  return words2.reduce((accum, word) => {
    if (word === sep) {
      initial++;
    } else if (word.match(Word)) {
      accum.push(String.fromCharCode(initial) + word);
    } else {
      initial = 97;
      accum.push(word);
    }
    return accum;
  }, []);
}
function decode(data, subs) {
  for (let i = subsChrs.length - 1; i >= 0; i--) {
    data = data.split(subsChrs[i]).join(subs.substring(2 * i, 2 * i + 2));
  }
  const clumps = [];
  const leftover = data.replace(/(:|([0-9])|([A-Z][a-z]*))/g, (all, item, semi, word) => {
    if (semi) {
      for (let i = parseInt(semi); i >= 0; i--) {
        clumps.push(";");
      }
    } else {
      clumps.push(item.toLowerCase());
    }
    return "";
  });
  if (leftover) {
    throw new Error(`leftovers: ${JSON.stringify(leftover)}`);
  }
  return unfold(unfold(clumps, ";"), ":");
}
function decodeOwl(data) {
  assertArgument(data[0] === "0", "unsupported auwl data", "data", data);
  return decode(data.substring(1 + 2 * subsChrs.length), data.substring(1, 1 + 2 * subsChrs.length));
}

// node_modules/ethers/lib.esm/wordlists/wordlist.js
var Wordlist = class {
  locale;
  /**
   *  Creates a new Wordlist instance.
   *
   *  Sub-classes MUST call this if they provide their own constructor,
   *  passing in the locale string of the language.
   *
   *  Generally there is no need to create instances of a Wordlist,
   *  since each language-specific Wordlist creates an instance and
   *  there is no state kept internally, so they are safe to share.
   */
  constructor(locale) {
    defineProperties(this, { locale });
  }
  /**
   *  Sub-classes may override this to provide a language-specific
   *  method for spliting %%phrase%% into individual words.
   *
   *  By default, %%phrase%% is split using any sequences of
   *  white-space as defined by regular expressions (i.e. ``/\s+/``).
   */
  split(phrase) {
    return phrase.toLowerCase().split(/\s+/g);
  }
  /**
   *  Sub-classes may override this to provider a language-specific
   *  method for joining %%words%% into a phrase.
   *
   *  By default, %%words%% are joined by a single space.
   */
  join(words2) {
    return words2.join(" ");
  }
};

// node_modules/ethers/lib.esm/wordlists/wordlist-owl.js
var WordlistOwl = class extends Wordlist {
  #data;
  #checksum;
  /**
   *  Creates a new Wordlist for %%locale%% using the OWL %%data%%
   *  and validated against the %%checksum%%.
   */
  constructor(locale, data, checksum2) {
    super(locale);
    this.#data = data;
    this.#checksum = checksum2;
    this.#words = null;
  }
  /**
   *  The OWL-encoded data.
   */
  get _data() {
    return this.#data;
  }
  /**
   *  Decode all the words for the wordlist.
   */
  _decodeWords() {
    return decodeOwl(this.#data);
  }
  #words;
  #loadWords() {
    if (this.#words == null) {
      const words2 = this._decodeWords();
      const checksum2 = id(words2.join("\n") + "\n");
      if (checksum2 !== this.#checksum) {
        throw new Error(`BIP39 Wordlist for ${this.locale} FAILED`);
      }
      this.#words = words2;
    }
    return this.#words;
  }
  getWord(index) {
    const words2 = this.#loadWords();
    assertArgument(index >= 0 && index < words2.length, `invalid word index: ${index}`, "index", index);
    return words2[index];
  }
  getWordIndex(word) {
    return this.#loadWords().indexOf(word);
  }
};

// node_modules/ethers/lib.esm/wordlists/lang-en.js
var words = "0erleonalorenseinceregesticitStanvetearctssi#ch2Athck&tneLl0And#Il.yLeOutO=S|S%b/ra@SurdU'0Ce[Cid|CountCu'Hie=IdOu,-Qui*Ro[TT]T%T*[Tu$0AptDD-tD*[Ju,M.UltV<)Vi)0Rob-0FairF%dRaid0A(EEntRee0Ead0MRRp%tS!_rmBumCoholErtI&LLeyLowMo,O}PhaReadySoT Ways0A>urAz(gOngOuntU'd0Aly,Ch%Ci|G G!GryIm$K!Noun)Nu$O` Sw T&naTiqueXietyY1ArtOlogyPe?P!Pro=Ril1ChCt-EaEnaGueMMedM%MyOundR<+Re,Ri=RowTTefa@Ti,Tw%k0KPe@SaultSetSi,SumeThma0H!>OmTa{T&dT.udeTra@0Ct]D.Gu,NtTh%ToTumn0Era+OcadoOid0AkeA*AyEsomeFulKw?d0Is:ByChel%C#D+GL<)Lc#y~MbooN<aNn RRelyRga(R*lSeS-SketTt!3A^AnAutyCau'ComeEfF%eG(Ha=H(dLie=LowLtN^Nef./TrayTt Twe&Y#d3Cyc!DKeNdOlogyRdR`Tt _{AdeAmeAnketA,EakE[IndOodO[omOu'UeUrUsh_rdAtDyIlMbNeNusOkO,Rd R(gRrowSsTtomUn)XY_{etA(AndA[A=EadEezeI{Id+IefIghtIngIskOccoliOk&OnzeOomO` OwnUsh2Bb!DdyD+tFf$oIldLbLkL!tNd!Nk Rd&Rg R,SS(e[SyTt Y Zz:Bba+B(B!CtusGeKe~LmM aMpNN$N)lNdyNn#NoeNvasNy#Pab!P.$Pta(RRb#RdRgoRpetRryRtSeShS(o/!Su$TT$ogT^Teg%yTt!UghtU'Ut]Ve3Il(gL yM|NsusNturyRe$Rta(_irAlkAmp]An+AosApt Ar+A'AtEapE{Ee'EfErryE,I{&IefIldIm}yOi)Oo'R#-U{!UnkUrn0G?Nnam#Rc!Tiz&TyVil_imApArifyAwAyE<ErkEv I{I|IffImbIn-IpO{OgO'O`OudOwnUbUmpU, Ut^_^A,C#utDeFfeeIlInL!@L%LumnMb(eMeMf%tM-Mm#Mp<yNc tNdu@NfirmNg*[N}@Nsid NtrolNv()OkOlPp PyR$ReRnR*@/Tt#U^UntryUp!Ur'Us(V Yo>_{Ad!AftAmA}AshAt AwlAzyEamEd.EekEwI{etImeIspIt-OpO[Ou^OwdUci$UelUi'Umb!Un^UshYY,$2BeLtu*PPbo?dRiousRr|Rta(R=Sh]/omTe3C!:DMa+MpN)Ng R(gShUght WnY3AlBa>BrisCadeCemb CideCl(eC%a>C*a'ErF&'F(eFyG*eLayLiv M<dMi'Ni$Nti,NyP?tP&dPos.P`PutyRi=ScribeS tSignSkSpair/royTailTe@VelopVi)Vo>3AgramAlAm#dAryCeE'lEtFf G.$Gn.yLemmaNn NosaurRe@RtSag*eScov Sea'ShSmi[S%d Splay/<)V tVideV%)Zzy5Ct%Cum|G~Lph(Ma(Na>NkeyN%OrSeUb!Ve_ftAg#AmaA,-AwEamE[IftIllInkIpI=OpUmY2CkMbNeR(g/T^Ty1Arf1Nam-:G G!RlyRnR`Sily/Sy1HoOlogyOnomy0GeItUca>1F%t0G1GhtTh 2BowD E@r-Eg<tEm|Eph<tEvat%I>Se0B?kBodyBra)Er+Ot]PloyPow Pty0Ab!A@DD![D%'EmyErgyF%)Ga+G(eH<)JoyLi,OughR-hRollSu*T Ti*TryVelope1Isode0U$Uip0AA'OdeOs]R%Upt0CapeSayS&)Ta>0Ern$H-s1Id&)IlOkeOl=1A@Amp!Ce[Ch<+C.eCludeCu'Ecu>Erci'Hau,Hib.I!I,ItOt-P<dPe@Pi*Pla(Po'P*[T&dTra0EEbrow:Br-CeCultyDeIntI`~L'MeMilyMousNNcyNtasyRmSh]TT$Th TigueUltV%.e3Atu*Bru?yD $EEdElMa!N)/iv$T^V W3B Ct]EldGu*LeLmLt N$NdNeNg NishReRmR,Sc$ShTT}[X_gAmeAshAtAv%EeIghtIpOatO{O%Ow UidUshY_mCusGIlLd~owOdOtR)Re,R+tRkRtu}RumRw?dSsil/ UndX_gi!AmeEqu|EshI&dIn+OgOntO,OwnOz&U.2ElNNnyRna)RyTu*:D+tInLaxy~ yMePRa+Rba+Rd&Rl-Rm|SSpTeTh U+Ze3N $NiusN*Nt!Nu(e/u*2O,0AntFtGg!Ng RaffeRlVe_dAn)A*A[IdeImp'ObeOomOryO=OwUe_tDde[LdOdO'RillaSpelSsipV nWn_bA)A(AntApeA[Av.yEatE&IdIefItOc yOupOwUnt_rdE[IdeIltIt?N3M:B.IrLfMm M, NdPpyRb%RdRshR=,TVeWkZ?d3AdAl`ArtAvyD+hogIght~oLmetLpNRo3Dd&Gh~NtPRe/%y5BbyCkeyLdLeLiday~owMeNeyOdPeRnRr%R'Sp.$/TelUrV 5BGeM<Mb!M%Nd*dNgryNtRd!RryRtSb<d3Brid:1EOn0EaEntifyLe2N%e4LLeg$L}[0A+Ita>M&'Mu}Pa@Po'Pro=Pul'0ChCludeComeC*a'DexD-a>Do%Du,ryF<tFl-tF%mHa!H .Iti$Je@JuryMa>N Noc|PutQuiryS<eSe@SideSpi*/$lTa@T e,ToVe,V.eVol=3On0L<dOla>Sue0Em1Ory:CketGu?RZz3AlousAns~yWel9BInKeUr}yY5D+I)MpNg!Ni%Nk/:Ng?oo3EnEpT^upY3CkDD}yNdNgdomSsTT^&TeTt&Wi4EeIfeO{Ow:BBelB%Dd DyKeMpNgua+PtopR+T T(UghUndryVaWWnWsu.Y Zy3Ad AfArnA=Ctu*FtGG$G&dIsu*M#NdNg`NsOp?dSs#Tt Vel3ArB tyBr?yC&'FeFtGhtKeMbM.NkOnQuid/Tt!VeZ?d5AdAnB, C$CkG-NelyNgOpTt yUdUn+VeY$5CkyGga+Mb N?N^Xury3R-s:Ch(eDG-G}tIdIlInJ%KeMm$NNa+Nda>NgoNs]Nu$P!Rb!R^Rg(R(eRketRria+SkSs/ T^T i$ThTrixTt XimumZe3AdowAnAsu*AtCh<-D$DiaLodyLtMb M%yNt]NuRcyR+R.RryShSsa+T$Thod3Dd!DnightLk~]M-NdNimumN%Nu>Rac!Rr%S ySs/akeXXedXtu*5Bi!DelDifyMM|N.%NkeyN, N`OnR$ReRn(gSqu.oTh T]T%Unta(U'VeVie5ChFf(LeLtiplySc!SeumShroomS-/Tu$3Self/ yTh:I=MePk(Rrow/yT]Tu*3ArCkEdGati=G!@I` PhewR=/TTw%kUtr$V WsXt3CeGht5B!I'M(eeOd!Rm$R`SeTab!TeTh(gTi)VelW5C!?Mb R'T:K0EyJe@Li+Scu*S =Ta(Vious0CurE<Tob 0Or1FF Fi)T&2L1Ay0DI=Ymp-0It0CeEI#L(eLy1EnEraIn]Po'T]1An+B.Ch?dD D(?yG<I|Ig($Ph<0Tr-h0H 0Tdo%T TputTside0AlEnEr0NN 0Yg&0/ 0O}:CtDd!GeIrLa)LmNdaNelN-N` P RadeR|RkRrotRtySsT^ThTi|TrolTt nU'VeYm|3A)AnutArAs<tL-<NN$tyNcilOp!Pp Rfe@Rm.Rs#T2O}OtoRa'Ys-$0AnoCn-Ctu*E)GGe#~LotNkO} Pe/olT^Zza_)A}tA,-A>AyEa'Ed+U{UgUn+2EmEtIntL?LeLi)NdNyOlPul?Rt]S.]Ssib!/TatoTt yV tyWd W _@i)Ai'Ed-tEf Epa*Es|EttyEv|I)IdeIm?yIntI%.yIs#Iva>IzeOb!mO)[Odu)Of.OgramOje@Omo>OofOp tyOsp O>@OudOvide2Bl-Dd(g~LpL'Mpk(N^PilPpyR^a'R.yRpo'R'ShTZz!3Ramid:99Al.yAntumArt E,]I{ItIzO>:Bb.Cco#CeCkD?DioIlInI'~yMpN^NdomN+PidReTeTh V&WZ%3AdyAlAs#BelBuildC$lCei=CipeC%dCyc!Du)F!@F%mFu'G]G*tGul?Je@LaxLea'LiefLyMa(Memb M(dMo=Nd NewNtOp&PairPeatPla)P%tQui*ScueSemb!Si,Sour)Sp#'SultTi*T*atTurnUn]Ve$ViewW?d2Y`m0BBb#CeChDeD+F!GhtGidNgOtPp!SkTu$V$V 5AdA,BotBu,CketM<)OfOkieOmSeTa>UghUndU>Y$5Bb DeGLeNNwayR$:DDd!D}[FeIlLadLm#L#LtLu>MeMp!NdTisfyToshiU)Usa+VeY1A!AnA*Att E}HemeHoolI&)I[%sOrp]OutRapRe&RiptRub1AAr^As#AtC#dC*tCt]Cur.yEdEkGm|Le@~M(?Ni%N'Nt&)RiesRvi)Ss]Tt!TupV&_dowAftAllowA*EdEllEriffIeldIftI}IpIv O{OeOotOpOrtOuld O=RimpRugUff!Y0Bl(gCkDeE+GhtGnL|Lk~yLv Mil?Mp!N)NgR&/ Tua>XZe1A>Et^IIllInIrtUll0AbAmEepEnd I)IdeIghtImOg<OtOwUsh0AllArtI!OkeOo`0A{AkeApIffOw0ApCc Ci$CkDaFtL?Ldi LidLut]L=Me#eNgOnRryRtUlUndUpUr)U`0A)A*Ati$AwnEakEci$EedEllEndH eI)Id IkeInIr.L.OilOns%O#OrtOtRayReadR(gY0Ua*UeezeUir*l_b!AdiumAffA+AirsAmpAndArtA>AyEakEelEmEpE*oI{IllIngO{Oma^O}OolOryO=Ra>gyReetRikeR#gRugg!Ud|UffUmb!Y!0Bje@Bm.BwayC)[ChDd&Ff G?G+,ItMm NNnyN'tP PplyP*meReRfa)R+Rpri'RroundR=ySpe@/a(1AllowAmpApArmE?EetIftImIngIt^Ord1MbolMptomRup/em:B!Ck!GIlL|LkNkPeR+tSk/eTtooXi3A^Am~NN<tNnisNtRm/Xt_nkAtEmeEnE%yE*EyIngIsOughtReeRi=RowUmbUnd 0CketDeG LtMb MeNyPRedSsueT!5A,BaccoDayDdl EGe` I!tK&MatoM%rowNeNgueNightOlO`PP-Pp!R^RnadoRtoi'SsT$Uri,W?dW WnY_{AdeAff-Ag-A(Ansf ApAshA=lAyEatEeEndI$IbeI{Igg ImIpOphyOub!U{UeUlyUmpetU,U`Y2BeIt]Mb!NaN}lRkeyRnRt!1El=EntyI)InI,O1PeP-$:5Ly5B*lla0Ab!Awa*C!Cov D DoFairFoldHappyIf%mIqueItIv 'KnownLo{TilUsu$Veil1Da>GradeHoldOnP Set1B<Ge0A+EEdEfulE![U$0Il.y:C<tCuumGueLidL!yL=NNishP%Rious/Ult3H-!L=tNd%Ntu*NueRbRifyRs]RyS'lT <3Ab!Br<tCiousCt%yDeoEw~a+Nta+Ol(Rtu$RusSaS.Su$T$Vid5C$I)IdLc<oLumeTeYa+:GeG#ItLk~LnutNtRfa*RmRri%ShSp/eT VeY3Al`Ap#ArA'lA` BDd(gEk&dIrdLcome/T_!AtEatEelEnE*IpIsp 0DeD`FeLd~NNdowNeNgNkNn Nt ReSdomSeShT}[5LfM<Nd OdOlRdRkRldRryR`_pE{E,!I,I>Ong::Rd3Ar~ow9UUngU`:3BraRo9NeO";
var checksum = "0x3c8acc1e7b08d8e76f9fda015ef48dc8c710a73cb7e0f77b2c18a9b5a7adde60";
var wordlist = null;
var LangEn = class _LangEn extends WordlistOwl {
  /**
   *  Creates a new instance of the English language Wordlist.
   *
   *  This should be unnecessary most of the time as the exported
   *  [[langEn]] should suffice.
   *
   *  @_ignore:
   */
  constructor() {
    super("en", words, checksum);
  }
  /**
   *  Returns a singleton instance of a ``LangEn``, creating it
   *  if this is the first time being called.
   */
  static wordlist() {
    if (wordlist == null) {
      wordlist = new _LangEn();
    }
    return wordlist;
  }
};

// node_modules/ethers/lib.esm/wallet/mnemonic.js
function getUpperMask(bits) {
  return (1 << bits) - 1 << 8 - bits & 255;
}
function getLowerMask(bits) {
  return (1 << bits) - 1 & 255;
}
function mnemonicToEntropy(mnemonic, wordlist2) {
  assertNormalize("NFKD");
  if (wordlist2 == null) {
    wordlist2 = LangEn.wordlist();
  }
  const words2 = wordlist2.split(mnemonic);
  assertArgument(words2.length % 3 === 0 && words2.length >= 12 && words2.length <= 24, "invalid mnemonic length", "mnemonic", "[ REDACTED ]");
  const entropy = new Uint8Array(Math.ceil(11 * words2.length / 8));
  let offset = 0;
  for (let i = 0; i < words2.length; i++) {
    let index = wordlist2.getWordIndex(words2[i].normalize("NFKD"));
    assertArgument(index >= 0, `invalid mnemonic word at index ${i}`, "mnemonic", "[ REDACTED ]");
    for (let bit = 0; bit < 11; bit++) {
      if (index & 1 << 10 - bit) {
        entropy[offset >> 3] |= 1 << 7 - offset % 8;
      }
      offset++;
    }
  }
  const entropyBits = 32 * words2.length / 3;
  const checksumBits = words2.length / 3;
  const checksumMask = getUpperMask(checksumBits);
  const checksum2 = getBytes(sha2562(entropy.slice(0, entropyBits / 8)))[0] & checksumMask;
  assertArgument(checksum2 === (entropy[entropy.length - 1] & checksumMask), "invalid mnemonic checksum", "mnemonic", "[ REDACTED ]");
  return hexlify(entropy.slice(0, entropyBits / 8));
}
function entropyToMnemonic(entropy, wordlist2) {
  assertArgument(entropy.length % 4 === 0 && entropy.length >= 16 && entropy.length <= 32, "invalid entropy size", "entropy", "[ REDACTED ]");
  if (wordlist2 == null) {
    wordlist2 = LangEn.wordlist();
  }
  const indices = [0];
  let remainingBits = 11;
  for (let i = 0; i < entropy.length; i++) {
    if (remainingBits > 8) {
      indices[indices.length - 1] <<= 8;
      indices[indices.length - 1] |= entropy[i];
      remainingBits -= 8;
    } else {
      indices[indices.length - 1] <<= remainingBits;
      indices[indices.length - 1] |= entropy[i] >> 8 - remainingBits;
      indices.push(entropy[i] & getLowerMask(8 - remainingBits));
      remainingBits += 3;
    }
  }
  const checksumBits = entropy.length / 4;
  const checksum2 = parseInt(sha2562(entropy).substring(2, 4), 16) & getUpperMask(checksumBits);
  indices[indices.length - 1] <<= checksumBits;
  indices[indices.length - 1] |= checksum2 >> 8 - checksumBits;
  return wordlist2.join(indices.map((index) => wordlist2.getWord(index)));
}
var _guard5 = {};
var Mnemonic = class _Mnemonic {
  /**
   *  The mnemonic phrase of 12, 15, 18, 21 or 24 words.
   *
   *  Use the [[wordlist]] ``split`` method to get the individual words.
   */
  phrase;
  /**
   *  The password used for this mnemonic. If no password is used this
   *  is the empty string (i.e. ``""``) as per the specification.
   */
  password;
  /**
   *  The wordlist for this mnemonic.
   */
  wordlist;
  /**
   *  The underlying entropy which the mnemonic encodes.
   */
  entropy;
  /**
   *  @private
   */
  constructor(guard, entropy, phrase, password, wordlist2) {
    if (password == null) {
      password = "";
    }
    if (wordlist2 == null) {
      wordlist2 = LangEn.wordlist();
    }
    assertPrivate(guard, _guard5, "Mnemonic");
    defineProperties(this, { phrase, password, wordlist: wordlist2, entropy });
  }
  /**
   *  Returns the seed for the mnemonic.
   */
  computeSeed() {
    const salt = toUtf8Bytes("mnemonic" + this.password, "NFKD");
    return pbkdf2(toUtf8Bytes(this.phrase, "NFKD"), salt, 2048, 64, "sha512");
  }
  /**
   *  Creates a new Mnemonic for the %%phrase%%.
   *
   *  The default %%password%% is the empty string and the default
   *  wordlist is the [English wordlists](LangEn).
   */
  static fromPhrase(phrase, password, wordlist2) {
    const entropy = mnemonicToEntropy(phrase, wordlist2);
    phrase = entropyToMnemonic(getBytes(entropy), wordlist2);
    return new _Mnemonic(_guard5, entropy, phrase, password, wordlist2);
  }
  /**
   *  Create a new **Mnemonic** from the %%entropy%%.
   *
   *  The default %%password%% is the empty string and the default
   *  wordlist is the [English wordlists](LangEn).
   */
  static fromEntropy(_entropy, password, wordlist2) {
    const entropy = getBytes(_entropy, "entropy");
    const phrase = entropyToMnemonic(entropy, wordlist2);
    return new _Mnemonic(_guard5, hexlify(entropy), phrase, password, wordlist2);
  }
  /**
   *  Returns the phrase for %%mnemonic%%.
   */
  static entropyToPhrase(_entropy, wordlist2) {
    const entropy = getBytes(_entropy, "entropy");
    return entropyToMnemonic(entropy, wordlist2);
  }
  /**
   *  Returns the entropy for %%phrase%%.
   */
  static phraseToEntropy(phrase, wordlist2) {
    return mnemonicToEntropy(phrase, wordlist2);
  }
  /**
   *  Returns true if %%phrase%% is a valid [[link-bip-39]] phrase.
   *
   *  This checks all the provided words belong to the %%wordlist%%,
   *  that the length is valid and the checksum is correct.
   */
  static isValidMnemonic(phrase, wordlist2) {
    try {
      mnemonicToEntropy(phrase, wordlist2);
      return true;
    } catch (error) {
    }
    return false;
  }
};

// node_modules/aes-js/lib.esm/aes.js
var __classPrivateFieldGet = function(receiver, state, kind, f2) {
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
};
var __classPrivateFieldSet = function(receiver, state, value, kind, f2) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f2.call(receiver, value) : f2 ? f2.value = value : state.set(receiver, value), value;
};
var _AES_key;
var _AES_Kd;
var _AES_Ke;
var numberOfRounds = { 16: 10, 24: 12, 32: 14 };
var rcon = [1, 2, 4, 8, 16, 32, 64, 128, 27, 54, 108, 216, 171, 77, 154, 47, 94, 188, 99, 198, 151, 53, 106, 212, 179, 125, 250, 239, 197, 145];
var S = [99, 124, 119, 123, 242, 107, 111, 197, 48, 1, 103, 43, 254, 215, 171, 118, 202, 130, 201, 125, 250, 89, 71, 240, 173, 212, 162, 175, 156, 164, 114, 192, 183, 253, 147, 38, 54, 63, 247, 204, 52, 165, 229, 241, 113, 216, 49, 21, 4, 199, 35, 195, 24, 150, 5, 154, 7, 18, 128, 226, 235, 39, 178, 117, 9, 131, 44, 26, 27, 110, 90, 160, 82, 59, 214, 179, 41, 227, 47, 132, 83, 209, 0, 237, 32, 252, 177, 91, 106, 203, 190, 57, 74, 76, 88, 207, 208, 239, 170, 251, 67, 77, 51, 133, 69, 249, 2, 127, 80, 60, 159, 168, 81, 163, 64, 143, 146, 157, 56, 245, 188, 182, 218, 33, 16, 255, 243, 210, 205, 12, 19, 236, 95, 151, 68, 23, 196, 167, 126, 61, 100, 93, 25, 115, 96, 129, 79, 220, 34, 42, 144, 136, 70, 238, 184, 20, 222, 94, 11, 219, 224, 50, 58, 10, 73, 6, 36, 92, 194, 211, 172, 98, 145, 149, 228, 121, 231, 200, 55, 109, 141, 213, 78, 169, 108, 86, 244, 234, 101, 122, 174, 8, 186, 120, 37, 46, 28, 166, 180, 198, 232, 221, 116, 31, 75, 189, 139, 138, 112, 62, 181, 102, 72, 3, 246, 14, 97, 53, 87, 185, 134, 193, 29, 158, 225, 248, 152, 17, 105, 217, 142, 148, 155, 30, 135, 233, 206, 85, 40, 223, 140, 161, 137, 13, 191, 230, 66, 104, 65, 153, 45, 15, 176, 84, 187, 22];
var Si = [82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251, 124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203, 84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78, 8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37, 114, 248, 246, 100, 134, 104, 152, 22, 212, 164, 92, 204, 93, 101, 182, 146, 108, 112, 72, 80, 253, 237, 185, 218, 94, 21, 70, 87, 167, 141, 157, 132, 144, 216, 171, 0, 140, 188, 211, 10, 247, 228, 88, 5, 184, 179, 69, 6, 208, 44, 30, 143, 202, 63, 15, 2, 193, 175, 189, 3, 1, 19, 138, 107, 58, 145, 17, 65, 79, 103, 220, 234, 151, 242, 207, 206, 240, 180, 230, 115, 150, 172, 116, 34, 231, 173, 53, 133, 226, 249, 55, 232, 28, 117, 223, 110, 71, 241, 26, 113, 29, 41, 197, 137, 111, 183, 98, 14, 170, 24, 190, 27, 252, 86, 62, 75, 198, 210, 121, 32, 154, 219, 192, 254, 120, 205, 90, 244, 31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95, 96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239, 160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97, 23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125];
var T12 = [3328402341, 4168907908, 4000806809, 4135287693, 4294111757, 3597364157, 3731845041, 2445657428, 1613770832, 33620227, 3462883241, 1445669757, 3892248089, 3050821474, 1303096294, 3967186586, 2412431941, 528646813, 2311702848, 4202528135, 4026202645, 2992200171, 2387036105, 4226871307, 1101901292, 3017069671, 1604494077, 1169141738, 597466303, 1403299063, 3832705686, 2613100635, 1974974402, 3791519004, 1033081774, 1277568618, 1815492186, 2118074177, 4126668546, 2211236943, 1748251740, 1369810420, 3521504564, 4193382664, 3799085459, 2883115123, 1647391059, 706024767, 134480908, 2512897874, 1176707941, 2646852446, 806885416, 932615841, 168101135, 798661301, 235341577, 605164086, 461406363, 3756188221, 3454790438, 1311188841, 2142417613, 3933566367, 302582043, 495158174, 1479289972, 874125870, 907746093, 3698224818, 3025820398, 1537253627, 2756858614, 1983593293, 3084310113, 2108928974, 1378429307, 3722699582, 1580150641, 327451799, 2790478837, 3117535592, 0, 3253595436, 1075847264, 3825007647, 2041688520, 3059440621, 3563743934, 2378943302, 1740553945, 1916352843, 2487896798, 2555137236, 2958579944, 2244988746, 3151024235, 3320835882, 1336584933, 3992714006, 2252555205, 2588757463, 1714631509, 293963156, 2319795663, 3925473552, 67240454, 4269768577, 2689618160, 2017213508, 631218106, 1269344483, 2723238387, 1571005438, 2151694528, 93294474, 1066570413, 563977660, 1882732616, 4059428100, 1673313503, 2008463041, 2950355573, 1109467491, 537923632, 3858759450, 4260623118, 3218264685, 2177748300, 403442708, 638784309, 3287084079, 3193921505, 899127202, 2286175436, 773265209, 2479146071, 1437050866, 4236148354, 2050833735, 3362022572, 3126681063, 840505643, 3866325909, 3227541664, 427917720, 2655997905, 2749160575, 1143087718, 1412049534, 999329963, 193497219, 2353415882, 3354324521, 1807268051, 672404540, 2816401017, 3160301282, 369822493, 2916866934, 3688947771, 1681011286, 1949973070, 336202270, 2454276571, 201721354, 1210328172, 3093060836, 2680341085, 3184776046, 1135389935, 3294782118, 965841320, 831886756, 3554993207, 4068047243, 3588745010, 2345191491, 1849112409, 3664604599, 26054028, 2983581028, 2622377682, 1235855840, 3630984372, 2891339514, 4092916743, 3488279077, 3395642799, 4101667470, 1202630377, 268961816, 1874508501, 4034427016, 1243948399, 1546530418, 941366308, 1470539505, 1941222599, 2546386513, 3421038627, 2715671932, 3899946140, 1042226977, 2521517021, 1639824860, 227249030, 260737669, 3765465232, 2084453954, 1907733956, 3429263018, 2420656344, 100860677, 4160157185, 470683154, 3261161891, 1781871967, 2924959737, 1773779408, 394692241, 2579611992, 974986535, 664706745, 3655459128, 3958962195, 731420851, 571543859, 3530123707, 2849626480, 126783113, 865375399, 765172662, 1008606754, 361203602, 3387549984, 2278477385, 2857719295, 1344809080, 2782912378, 59542671, 1503764984, 160008576, 437062935, 1707065306, 3622233649, 2218934982, 3496503480, 2185314755, 697932208, 1512910199, 504303377, 2075177163, 2824099068, 1841019862, 739644986];
var T2 = [2781242211, 2230877308, 2582542199, 2381740923, 234877682, 3184946027, 2984144751, 1418839493, 1348481072, 50462977, 2848876391, 2102799147, 434634494, 1656084439, 3863849899, 2599188086, 1167051466, 2636087938, 1082771913, 2281340285, 368048890, 3954334041, 3381544775, 201060592, 3963727277, 1739838676, 4250903202, 3930435503, 3206782108, 4149453988, 2531553906, 1536934080, 3262494647, 484572669, 2923271059, 1783375398, 1517041206, 1098792767, 49674231, 1334037708, 1550332980, 4098991525, 886171109, 150598129, 2481090929, 1940642008, 1398944049, 1059722517, 201851908, 1385547719, 1699095331, 1587397571, 674240536, 2704774806, 252314885, 3039795866, 151914247, 908333586, 2602270848, 1038082786, 651029483, 1766729511, 3447698098, 2682942837, 454166793, 2652734339, 1951935532, 775166490, 758520603, 3000790638, 4004797018, 4217086112, 4137964114, 1299594043, 1639438038, 3464344499, 2068982057, 1054729187, 1901997871, 2534638724, 4121318227, 1757008337, 0, 750906861, 1614815264, 535035132, 3363418545, 3988151131, 3201591914, 1183697867, 3647454910, 1265776953, 3734260298, 3566750796, 3903871064, 1250283471, 1807470800, 717615087, 3847203498, 384695291, 3313910595, 3617213773, 1432761139, 2484176261, 3481945413, 283769337, 100925954, 2180939647, 4037038160, 1148730428, 3123027871, 3813386408, 4087501137, 4267549603, 3229630528, 2315620239, 2906624658, 3156319645, 1215313976, 82966005, 3747855548, 3245848246, 1974459098, 1665278241, 807407632, 451280895, 251524083, 1841287890, 1283575245, 337120268, 891687699, 801369324, 3787349855, 2721421207, 3431482436, 959321879, 1469301956, 4065699751, 2197585534, 1199193405, 2898814052, 3887750493, 724703513, 2514908019, 2696962144, 2551808385, 3516813135, 2141445340, 1715741218, 2119445034, 2872807568, 2198571144, 3398190662, 700968686, 3547052216, 1009259540, 2041044702, 3803995742, 487983883, 1991105499, 1004265696, 1449407026, 1316239930, 504629770, 3683797321, 168560134, 1816667172, 3837287516, 1570751170, 1857934291, 4014189740, 2797888098, 2822345105, 2754712981, 936633572, 2347923833, 852879335, 1133234376, 1500395319, 3084545389, 2348912013, 1689376213, 3533459022, 3762923945, 3034082412, 4205598294, 133428468, 634383082, 2949277029, 2398386810, 3913789102, 403703816, 3580869306, 2297460856, 1867130149, 1918643758, 607656988, 4049053350, 3346248884, 1368901318, 600565992, 2090982877, 2632479860, 557719327, 3717614411, 3697393085, 2249034635, 2232388234, 2430627952, 1115438654, 3295786421, 2865522278, 3633334344, 84280067, 33027830, 303828494, 2747425121, 1600795957, 4188952407, 3496589753, 2434238086, 1486471617, 658119965, 3106381470, 953803233, 334231800, 3005978776, 857870609, 3151128937, 1890179545, 2298973838, 2805175444, 3056442267, 574365214, 2450884487, 550103529, 1233637070, 4289353045, 2018519080, 2057691103, 2399374476, 4166623649, 2148108681, 387583245, 3664101311, 836232934, 3330556482, 3100665960, 3280093505, 2955516313, 2002398509, 287182607, 3413881008, 4238890068, 3597515707, 975967766];
var T3 = [1671808611, 2089089148, 2006576759, 2072901243, 4061003762, 1807603307, 1873927791, 3310653893, 810573872, 16974337, 1739181671, 729634347, 4263110654, 3613570519, 2883997099, 1989864566, 3393556426, 2191335298, 3376449993, 2106063485, 4195741690, 1508618841, 1204391495, 4027317232, 2917941677, 3563566036, 2734514082, 2951366063, 2629772188, 2767672228, 1922491506, 3227229120, 3082974647, 4246528509, 2477669779, 644500518, 911895606, 1061256767, 4144166391, 3427763148, 878471220, 2784252325, 3845444069, 4043897329, 1905517169, 3631459288, 827548209, 356461077, 67897348, 3344078279, 593839651, 3277757891, 405286936, 2527147926, 84871685, 2595565466, 118033927, 305538066, 2157648768, 3795705826, 3945188843, 661212711, 2999812018, 1973414517, 152769033, 2208177539, 745822252, 439235610, 455947803, 1857215598, 1525593178, 2700827552, 1391895634, 994932283, 3596728278, 3016654259, 695947817, 3812548067, 795958831, 2224493444, 1408607827, 3513301457, 0, 3979133421, 543178784, 4229948412, 2982705585, 1542305371, 1790891114, 3410398667, 3201918910, 961245753, 1256100938, 1289001036, 1491644504, 3477767631, 3496721360, 4012557807, 2867154858, 4212583931, 1137018435, 1305975373, 861234739, 2241073541, 1171229253, 4178635257, 33948674, 2139225727, 1357946960, 1011120188, 2679776671, 2833468328, 1374921297, 2751356323, 1086357568, 2408187279, 2460827538, 2646352285, 944271416, 4110742005, 3168756668, 3066132406, 3665145818, 560153121, 271589392, 4279952895, 4077846003, 3530407890, 3444343245, 202643468, 322250259, 3962553324, 1608629855, 2543990167, 1154254916, 389623319, 3294073796, 2817676711, 2122513534, 1028094525, 1689045092, 1575467613, 422261273, 1939203699, 1621147744, 2174228865, 1339137615, 3699352540, 577127458, 712922154, 2427141008, 2290289544, 1187679302, 3995715566, 3100863416, 339486740, 3732514782, 1591917662, 186455563, 3681988059, 3762019296, 844522546, 978220090, 169743370, 1239126601, 101321734, 611076132, 1558493276, 3260915650, 3547250131, 2901361580, 1655096418, 2443721105, 2510565781, 3828863972, 2039214713, 3878868455, 3359869896, 928607799, 1840765549, 2374762893, 3580146133, 1322425422, 2850048425, 1823791212, 1459268694, 4094161908, 3928346602, 1706019429, 2056189050, 2934523822, 135794696, 3134549946, 2022240376, 628050469, 779246638, 472135708, 2800834470, 3032970164, 3327236038, 3894660072, 3715932637, 1956440180, 522272287, 1272813131, 3185336765, 2340818315, 2323976074, 1888542832, 1044544574, 3049550261, 1722469478, 1222152264, 50660867, 4127324150, 236067854, 1638122081, 895445557, 1475980887, 3117443513, 2257655686, 3243809217, 489110045, 2662934430, 3778599393, 4162055160, 2561878936, 288563729, 1773916777, 3648039385, 2391345038, 2493985684, 2612407707, 505560094, 2274497927, 3911240169, 3460925390, 1442818645, 678973480, 3749357023, 2358182796, 2717407649, 2306869641, 219617805, 3218761151, 3862026214, 1120306242, 1756942440, 1103331905, 2578459033, 762796589, 252780047, 2966125488, 1425844308, 3151392187, 372911126];
var T4 = [1667474886, 2088535288, 2004326894, 2071694838, 4075949567, 1802223062, 1869591006, 3318043793, 808472672, 16843522, 1734846926, 724270422, 4278065639, 3621216949, 2880169549, 1987484396, 3402253711, 2189597983, 3385409673, 2105378810, 4210693615, 1499065266, 1195886990, 4042263547, 2913856577, 3570689971, 2728590687, 2947541573, 2627518243, 2762274643, 1920112356, 3233831835, 3082273397, 4261223649, 2475929149, 640051788, 909531756, 1061110142, 4160160501, 3435941763, 875846760, 2779116625, 3857003729, 4059105529, 1903268834, 3638064043, 825316194, 353713962, 67374088, 3351728789, 589522246, 3284360861, 404236336, 2526454071, 84217610, 2593830191, 117901582, 303183396, 2155911963, 3806477791, 3958056653, 656894286, 2998062463, 1970642922, 151591698, 2206440989, 741110872, 437923380, 454765878, 1852748508, 1515908788, 2694904667, 1381168804, 993742198, 3604373943, 3014905469, 690584402, 3823320797, 791638366, 2223281939, 1398011302, 3520161977, 0, 3991743681, 538992704, 4244381667, 2981218425, 1532751286, 1785380564, 3419096717, 3200178535, 960056178, 1246420628, 1280103576, 1482221744, 3486468741, 3503319995, 4025428677, 2863326543, 4227536621, 1128514950, 1296947098, 859002214, 2240123921, 1162203018, 4193849577, 33687044, 2139062782, 1347481760, 1010582648, 2678045221, 2829640523, 1364325282, 2745433693, 1077985408, 2408548869, 2459086143, 2644360225, 943212656, 4126475505, 3166494563, 3065430391, 3671750063, 555836226, 269496352, 4294908645, 4092792573, 3537006015, 3452783745, 202118168, 320025894, 3974901699, 1600119230, 2543297077, 1145359496, 387397934, 3301201811, 2812801621, 2122220284, 1027426170, 1684319432, 1566435258, 421079858, 1936954854, 1616945344, 2172753945, 1330631070, 3705438115, 572679748, 707427924, 2425400123, 2290647819, 1179044492, 4008585671, 3099120491, 336870440, 3739122087, 1583276732, 185277718, 3688593069, 3772791771, 842159716, 976899700, 168435220, 1229577106, 101059084, 606366792, 1549591736, 3267517855, 3553849021, 2897014595, 1650632388, 2442242105, 2509612081, 3840161747, 2038008818, 3890688725, 3368567691, 926374254, 1835907034, 2374863873, 3587531953, 1313788572, 2846482505, 1819063512, 1448540844, 4109633523, 3941213647, 1701162954, 2054852340, 2930698567, 134748176, 3132806511, 2021165296, 623210314, 774795868, 471606328, 2795958615, 3031746419, 3334885783, 3907527627, 3722280097, 1953799400, 522133822, 1263263126, 3183336545, 2341176845, 2324333839, 1886425312, 1044267644, 3048588401, 1718004428, 1212733584, 50529542, 4143317495, 235803164, 1633788866, 892690282, 1465383342, 3115962473, 2256965911, 3250673817, 488449850, 2661202215, 3789633753, 4177007595, 2560144171, 286339874, 1768537042, 3654906025, 2391705863, 2492770099, 2610673197, 505291324, 2273808917, 3924369609, 3469625735, 1431699370, 673740880, 3755965093, 2358021891, 2711746649, 2307489801, 218961690, 3217021541, 3873845719, 1111672452, 1751693520, 1094828930, 2576986153, 757954394, 252645662, 2964376443, 1414855848, 3149649517, 370555436];
var T5 = [1374988112, 2118214995, 437757123, 975658646, 1001089995, 530400753, 2902087851, 1273168787, 540080725, 2910219766, 2295101073, 4110568485, 1340463100, 3307916247, 641025152, 3043140495, 3736164937, 632953703, 1172967064, 1576976609, 3274667266, 2169303058, 2370213795, 1809054150, 59727847, 361929877, 3211623147, 2505202138, 3569255213, 1484005843, 1239443753, 2395588676, 1975683434, 4102977912, 2572697195, 666464733, 3202437046, 4035489047, 3374361702, 2110667444, 1675577880, 3843699074, 2538681184, 1649639237, 2976151520, 3144396420, 4269907996, 4178062228, 1883793496, 2403728665, 2497604743, 1383856311, 2876494627, 1917518562, 3810496343, 1716890410, 3001755655, 800440835, 2261089178, 3543599269, 807962610, 599762354, 33778362, 3977675356, 2328828971, 2809771154, 4077384432, 1315562145, 1708848333, 101039829, 3509871135, 3299278474, 875451293, 2733856160, 92987698, 2767645557, 193195065, 1080094634, 1584504582, 3178106961, 1042385657, 2531067453, 3711829422, 1306967366, 2438237621, 1908694277, 67556463, 1615861247, 429456164, 3602770327, 2302690252, 1742315127, 2968011453, 126454664, 3877198648, 2043211483, 2709260871, 2084704233, 4169408201, 0, 159417987, 841739592, 504459436, 1817866830, 4245618683, 260388950, 1034867998, 908933415, 168810852, 1750902305, 2606453969, 607530554, 202008497, 2472011535, 3035535058, 463180190, 2160117071, 1641816226, 1517767529, 470948374, 3801332234, 3231722213, 1008918595, 303765277, 235474187, 4069246893, 766945465, 337553864, 1475418501, 2943682380, 4003061179, 2743034109, 4144047775, 1551037884, 1147550661, 1543208500, 2336434550, 3408119516, 3069049960, 3102011747, 3610369226, 1113818384, 328671808, 2227573024, 2236228733, 3535486456, 2935566865, 3341394285, 496906059, 3702665459, 226906860, 2009195472, 733156972, 2842737049, 294930682, 1206477858, 2835123396, 2700099354, 1451044056, 573804783, 2269728455, 3644379585, 2362090238, 2564033334, 2801107407, 2776292904, 3669462566, 1068351396, 742039012, 1350078989, 1784663195, 1417561698, 4136440770, 2430122216, 775550814, 2193862645, 2673705150, 1775276924, 1876241833, 3475313331, 3366754619, 270040487, 3902563182, 3678124923, 3441850377, 1851332852, 3969562369, 2203032232, 3868552805, 2868897406, 566021896, 4011190502, 3135740889, 1248802510, 3936291284, 699432150, 832877231, 708780849, 3332740144, 899835584, 1951317047, 4236429990, 3767586992, 866637845, 4043610186, 1106041591, 2144161806, 395441711, 1984812685, 1139781709, 3433712980, 3835036895, 2664543715, 1282050075, 3240894392, 1181045119, 2640243204, 25965917, 4203181171, 4211818798, 3009879386, 2463879762, 3910161971, 1842759443, 2597806476, 933301370, 1509430414, 3943906441, 3467192302, 3076639029, 3776767469, 2051518780, 2631065433, 1441952575, 404016761, 1942435775, 1408749034, 1610459739, 3745345300, 2017778566, 3400528769, 3110650942, 941896748, 3265478751, 371049330, 3168937228, 675039627, 4279080257, 967311729, 135050206, 3635733660, 1683407248, 2076935265, 3576870512, 1215061108, 3501741890];
var T6 = [1347548327, 1400783205, 3273267108, 2520393566, 3409685355, 4045380933, 2880240216, 2471224067, 1428173050, 4138563181, 2441661558, 636813900, 4233094615, 3620022987, 2149987652, 2411029155, 1239331162, 1730525723, 2554718734, 3781033664, 46346101, 310463728, 2743944855, 3328955385, 3875770207, 2501218972, 3955191162, 3667219033, 768917123, 3545789473, 692707433, 1150208456, 1786102409, 2029293177, 1805211710, 3710368113, 3065962831, 401639597, 1724457132, 3028143674, 409198410, 2196052529, 1620529459, 1164071807, 3769721975, 2226875310, 486441376, 2499348523, 1483753576, 428819965, 2274680428, 3075636216, 598438867, 3799141122, 1474502543, 711349675, 129166120, 53458370, 2592523643, 2782082824, 4063242375, 2988687269, 3120694122, 1559041666, 730517276, 2460449204, 4042459122, 2706270690, 3446004468, 3573941694, 533804130, 2328143614, 2637442643, 2695033685, 839224033, 1973745387, 957055980, 2856345839, 106852767, 1371368976, 4181598602, 1033297158, 2933734917, 1179510461, 3046200461, 91341917, 1862534868, 4284502037, 605657339, 2547432937, 3431546947, 2003294622, 3182487618, 2282195339, 954669403, 3682191598, 1201765386, 3917234703, 3388507166, 0, 2198438022, 1211247597, 2887651696, 1315723890, 4227665663, 1443857720, 507358933, 657861945, 1678381017, 560487590, 3516619604, 975451694, 2970356327, 261314535, 3535072918, 2652609425, 1333838021, 2724322336, 1767536459, 370938394, 182621114, 3854606378, 1128014560, 487725847, 185469197, 2918353863, 3106780840, 3356761769, 2237133081, 1286567175, 3152976349, 4255350624, 2683765030, 3160175349, 3309594171, 878443390, 1988838185, 3704300486, 1756818940, 1673061617, 3403100636, 272786309, 1075025698, 545572369, 2105887268, 4174560061, 296679730, 1841768865, 1260232239, 4091327024, 3960309330, 3497509347, 1814803222, 2578018489, 4195456072, 575138148, 3299409036, 446754879, 3629546796, 4011996048, 3347532110, 3252238545, 4270639778, 915985419, 3483825537, 681933534, 651868046, 2755636671, 3828103837, 223377554, 2607439820, 1649704518, 3270937875, 3901806776, 1580087799, 4118987695, 3198115200, 2087309459, 2842678573, 3016697106, 1003007129, 2802849917, 1860738147, 2077965243, 164439672, 4100872472, 32283319, 2827177882, 1709610350, 2125135846, 136428751, 3874428392, 3652904859, 3460984630, 3572145929, 3593056380, 2939266226, 824852259, 818324884, 3224740454, 930369212, 2801566410, 2967507152, 355706840, 1257309336, 4148292826, 243256656, 790073846, 2373340630, 1296297904, 1422699085, 3756299780, 3818836405, 457992840, 3099667487, 2135319889, 77422314, 1560382517, 1945798516, 788204353, 1521706781, 1385356242, 870912086, 325965383, 2358957921, 2050466060, 2388260884, 2313884476, 4006521127, 901210569, 3990953189, 1014646705, 1503449823, 1062597235, 2031621326, 3212035895, 3931371469, 1533017514, 350174575, 2256028891, 2177544179, 1052338372, 741876788, 1606591296, 1914052035, 213705253, 2334669897, 1107234197, 1899603969, 3725069491, 2631447780, 2422494913, 1635502980, 1893020342, 1950903388, 1120974935];
var T7 = [2807058932, 1699970625, 2764249623, 1586903591, 1808481195, 1173430173, 1487645946, 59984867, 4199882800, 1844882806, 1989249228, 1277555970, 3623636965, 3419915562, 1149249077, 2744104290, 1514790577, 459744698, 244860394, 3235995134, 1963115311, 4027744588, 2544078150, 4190530515, 1608975247, 2627016082, 2062270317, 1507497298, 2200818878, 567498868, 1764313568, 3359936201, 2305455554, 2037970062, 1047239e3, 1910319033, 1337376481, 2904027272, 2892417312, 984907214, 1243112415, 830661914, 861968209, 2135253587, 2011214180, 2927934315, 2686254721, 731183368, 1750626376, 4246310725, 1820824798, 4172763771, 3542330227, 48394827, 2404901663, 2871682645, 671593195, 3254988725, 2073724613, 145085239, 2280796200, 2779915199, 1790575107, 2187128086, 472615631, 3029510009, 4075877127, 3802222185, 4107101658, 3201631749, 1646252340, 4270507174, 1402811438, 1436590835, 3778151818, 3950355702, 3963161475, 4020912224, 2667994737, 273792366, 2331590177, 104699613, 95345982, 3175501286, 2377486676, 1560637892, 3564045318, 369057872, 4213447064, 3919042237, 1137477952, 2658625497, 1119727848, 2340947849, 1530455833, 4007360968, 172466556, 266959938, 516552836, 0, 2256734592, 3980931627, 1890328081, 1917742170, 4294704398, 945164165, 3575528878, 958871085, 3647212047, 2787207260, 1423022939, 775562294, 1739656202, 3876557655, 2530391278, 2443058075, 3310321856, 547512796, 1265195639, 437656594, 3121275539, 719700128, 3762502690, 387781147, 218828297, 3350065803, 2830708150, 2848461854, 428169201, 122466165, 3720081049, 1627235199, 648017665, 4122762354, 1002783846, 2117360635, 695634755, 3336358691, 4234721005, 4049844452, 3704280881, 2232435299, 574624663, 287343814, 612205898, 1039717051, 840019705, 2708326185, 793451934, 821288114, 1391201670, 3822090177, 376187827, 3113855344, 1224348052, 1679968233, 2361698556, 1058709744, 752375421, 2431590963, 1321699145, 3519142200, 2734591178, 188127444, 2177869557, 3727205754, 2384911031, 3215212461, 2648976442, 2450346104, 3432737375, 1180849278, 331544205, 3102249176, 4150144569, 2952102595, 2159976285, 2474404304, 766078933, 313773861, 2570832044, 2108100632, 1668212892, 3145456443, 2013908262, 418672217, 3070356634, 2594734927, 1852171925, 3867060991, 3473416636, 3907448597, 2614737639, 919489135, 164948639, 2094410160, 2997825956, 590424639, 2486224549, 1723872674, 3157750862, 3399941250, 3501252752, 3625268135, 2555048196, 3673637356, 1343127501, 4130281361, 3599595085, 2957853679, 1297403050, 81781910, 3051593425, 2283490410, 532201772, 1367295589, 3926170974, 895287692, 1953757831, 1093597963, 492483431, 3528626907, 1446242576, 1192455638, 1636604631, 209336225, 344873464, 1015671571, 669961897, 3375740769, 3857572124, 2973530695, 3747192018, 1933530610, 3464042516, 935293895, 3454686199, 2858115069, 1863638845, 3683022916, 4085369519, 3292445032, 875313188, 1080017571, 3279033885, 621591778, 1233856572, 2504130317, 24197544, 3017672716, 3835484340, 3247465558, 2220981195, 3060847922, 1551124588, 1463996600];
var T8 = [4104605777, 1097159550, 396673818, 660510266, 2875968315, 2638606623, 4200115116, 3808662347, 821712160, 1986918061, 3430322568, 38544885, 3856137295, 718002117, 893681702, 1654886325, 2975484382, 3122358053, 3926825029, 4274053469, 796197571, 1290801793, 1184342925, 3556361835, 2405426947, 2459735317, 1836772287, 1381620373, 3196267988, 1948373848, 3764988233, 3385345166, 3263785589, 2390325492, 1480485785, 3111247143, 3780097726, 2293045232, 548169417, 3459953789, 3746175075, 439452389, 1362321559, 1400849762, 1685577905, 1806599355, 2174754046, 137073913, 1214797936, 1174215055, 3731654548, 2079897426, 1943217067, 1258480242, 529487843, 1437280870, 3945269170, 3049390895, 3313212038, 923313619, 679998e3, 3215307299, 57326082, 377642221, 3474729866, 2041877159, 133361907, 1776460110, 3673476453, 96392454, 878845905, 2801699524, 777231668, 4082475170, 2330014213, 4142626212, 2213296395, 1626319424, 1906247262, 1846563261, 562755902, 3708173718, 1040559837, 3871163981, 1418573201, 3294430577, 114585348, 1343618912, 2566595609, 3186202582, 1078185097, 3651041127, 3896688048, 2307622919, 425408743, 3371096953, 2081048481, 1108339068, 2216610296, 0, 2156299017, 736970802, 292596766, 1517440620, 251657213, 2235061775, 2933202493, 758720310, 265905162, 1554391400, 1532285339, 908999204, 174567692, 1474760595, 4002861748, 2610011675, 3234156416, 3693126241, 2001430874, 303699484, 2478443234, 2687165888, 585122620, 454499602, 151849742, 2345119218, 3064510765, 514443284, 4044981591, 1963412655, 2581445614, 2137062819, 19308535, 1928707164, 1715193156, 4219352155, 1126790795, 600235211, 3992742070, 3841024952, 836553431, 1669664834, 2535604243, 3323011204, 1243905413, 3141400786, 4180808110, 698445255, 2653899549, 2989552604, 2253581325, 3252932727, 3004591147, 1891211689, 2487810577, 3915653703, 4237083816, 4030667424, 2100090966, 865136418, 1229899655, 953270745, 3399679628, 3557504664, 4118925222, 2061379749, 3079546586, 2915017791, 983426092, 2022837584, 1607244650, 2118541908, 2366882550, 3635996816, 972512814, 3283088770, 1568718495, 3499326569, 3576539503, 621982671, 2895723464, 410887952, 2623762152, 1002142683, 645401037, 1494807662, 2595684844, 1335535747, 2507040230, 4293295786, 3167684641, 367585007, 3885750714, 1865862730, 2668221674, 2960971305, 2763173681, 1059270954, 2777952454, 2724642869, 1320957812, 2194319100, 2429595872, 2815956275, 77089521, 3973773121, 3444575871, 2448830231, 1305906550, 4021308739, 2857194700, 2516901860, 3518358430, 1787304780, 740276417, 1699839814, 1592394909, 2352307457, 2272556026, 188821243, 1729977011, 3687994002, 274084841, 3594982253, 3613494426, 2701949495, 4162096729, 322734571, 2837966542, 1640576439, 484830689, 1202797690, 3537852828, 4067639125, 349075736, 3342319475, 4157467219, 4255800159, 1030690015, 1155237496, 2951971274, 1757691577, 607398968, 2738905026, 499347990, 3794078908, 1011452712, 227885567, 2818666809, 213114376, 3034881240, 1455525988, 3414450555, 850817237, 1817998408, 3092726480];
var U1 = [0, 235474187, 470948374, 303765277, 941896748, 908933415, 607530554, 708780849, 1883793496, 2118214995, 1817866830, 1649639237, 1215061108, 1181045119, 1417561698, 1517767529, 3767586992, 4003061179, 4236429990, 4069246893, 3635733660, 3602770327, 3299278474, 3400528769, 2430122216, 2664543715, 2362090238, 2193862645, 2835123396, 2801107407, 3035535058, 3135740889, 3678124923, 3576870512, 3341394285, 3374361702, 3810496343, 3977675356, 4279080257, 4043610186, 2876494627, 2776292904, 3076639029, 3110650942, 2472011535, 2640243204, 2403728665, 2169303058, 1001089995, 899835584, 666464733, 699432150, 59727847, 226906860, 530400753, 294930682, 1273168787, 1172967064, 1475418501, 1509430414, 1942435775, 2110667444, 1876241833, 1641816226, 2910219766, 2743034109, 2976151520, 3211623147, 2505202138, 2606453969, 2302690252, 2269728455, 3711829422, 3543599269, 3240894392, 3475313331, 3843699074, 3943906441, 4178062228, 4144047775, 1306967366, 1139781709, 1374988112, 1610459739, 1975683434, 2076935265, 1775276924, 1742315127, 1034867998, 866637845, 566021896, 800440835, 92987698, 193195065, 429456164, 395441711, 1984812685, 2017778566, 1784663195, 1683407248, 1315562145, 1080094634, 1383856311, 1551037884, 101039829, 135050206, 437757123, 337553864, 1042385657, 807962610, 573804783, 742039012, 2531067453, 2564033334, 2328828971, 2227573024, 2935566865, 2700099354, 3001755655, 3168937228, 3868552805, 3902563182, 4203181171, 4102977912, 3736164937, 3501741890, 3265478751, 3433712980, 1106041591, 1340463100, 1576976609, 1408749034, 2043211483, 2009195472, 1708848333, 1809054150, 832877231, 1068351396, 766945465, 599762354, 159417987, 126454664, 361929877, 463180190, 2709260871, 2943682380, 3178106961, 3009879386, 2572697195, 2538681184, 2236228733, 2336434550, 3509871135, 3745345300, 3441850377, 3274667266, 3910161971, 3877198648, 4110568485, 4211818798, 2597806476, 2497604743, 2261089178, 2295101073, 2733856160, 2902087851, 3202437046, 2968011453, 3936291284, 3835036895, 4136440770, 4169408201, 3535486456, 3702665459, 3467192302, 3231722213, 2051518780, 1951317047, 1716890410, 1750902305, 1113818384, 1282050075, 1584504582, 1350078989, 168810852, 67556463, 371049330, 404016761, 841739592, 1008918595, 775550814, 540080725, 3969562369, 3801332234, 4035489047, 4269907996, 3569255213, 3669462566, 3366754619, 3332740144, 2631065433, 2463879762, 2160117071, 2395588676, 2767645557, 2868897406, 3102011747, 3069049960, 202008497, 33778362, 270040487, 504459436, 875451293, 975658646, 675039627, 641025152, 2084704233, 1917518562, 1615861247, 1851332852, 1147550661, 1248802510, 1484005843, 1451044056, 933301370, 967311729, 733156972, 632953703, 260388950, 25965917, 328671808, 496906059, 1206477858, 1239443753, 1543208500, 1441952575, 2144161806, 1908694277, 1675577880, 1842759443, 3610369226, 3644379585, 3408119516, 3307916247, 4011190502, 3776767469, 4077384432, 4245618683, 2809771154, 2842737049, 3144396420, 3043140495, 2673705150, 2438237621, 2203032232, 2370213795];
var U2 = [0, 185469197, 370938394, 487725847, 741876788, 657861945, 975451694, 824852259, 1483753576, 1400783205, 1315723890, 1164071807, 1950903388, 2135319889, 1649704518, 1767536459, 2967507152, 3152976349, 2801566410, 2918353863, 2631447780, 2547432937, 2328143614, 2177544179, 3901806776, 3818836405, 4270639778, 4118987695, 3299409036, 3483825537, 3535072918, 3652904859, 2077965243, 1893020342, 1841768865, 1724457132, 1474502543, 1559041666, 1107234197, 1257309336, 598438867, 681933534, 901210569, 1052338372, 261314535, 77422314, 428819965, 310463728, 3409685355, 3224740454, 3710368113, 3593056380, 3875770207, 3960309330, 4045380933, 4195456072, 2471224067, 2554718734, 2237133081, 2388260884, 3212035895, 3028143674, 2842678573, 2724322336, 4138563181, 4255350624, 3769721975, 3955191162, 3667219033, 3516619604, 3431546947, 3347532110, 2933734917, 2782082824, 3099667487, 3016697106, 2196052529, 2313884476, 2499348523, 2683765030, 1179510461, 1296297904, 1347548327, 1533017514, 1786102409, 1635502980, 2087309459, 2003294622, 507358933, 355706840, 136428751, 53458370, 839224033, 957055980, 605657339, 790073846, 2373340630, 2256028891, 2607439820, 2422494913, 2706270690, 2856345839, 3075636216, 3160175349, 3573941694, 3725069491, 3273267108, 3356761769, 4181598602, 4063242375, 4011996048, 3828103837, 1033297158, 915985419, 730517276, 545572369, 296679730, 446754879, 129166120, 213705253, 1709610350, 1860738147, 1945798516, 2029293177, 1239331162, 1120974935, 1606591296, 1422699085, 4148292826, 4233094615, 3781033664, 3931371469, 3682191598, 3497509347, 3446004468, 3328955385, 2939266226, 2755636671, 3106780840, 2988687269, 2198438022, 2282195339, 2501218972, 2652609425, 1201765386, 1286567175, 1371368976, 1521706781, 1805211710, 1620529459, 2105887268, 1988838185, 533804130, 350174575, 164439672, 46346101, 870912086, 954669403, 636813900, 788204353, 2358957921, 2274680428, 2592523643, 2441661558, 2695033685, 2880240216, 3065962831, 3182487618, 3572145929, 3756299780, 3270937875, 3388507166, 4174560061, 4091327024, 4006521127, 3854606378, 1014646705, 930369212, 711349675, 560487590, 272786309, 457992840, 106852767, 223377554, 1678381017, 1862534868, 1914052035, 2031621326, 1211247597, 1128014560, 1580087799, 1428173050, 32283319, 182621114, 401639597, 486441376, 768917123, 651868046, 1003007129, 818324884, 1503449823, 1385356242, 1333838021, 1150208456, 1973745387, 2125135846, 1673061617, 1756818940, 2970356327, 3120694122, 2802849917, 2887651696, 2637442643, 2520393566, 2334669897, 2149987652, 3917234703, 3799141122, 4284502037, 4100872472, 3309594171, 3460984630, 3545789473, 3629546796, 2050466060, 1899603969, 1814803222, 1730525723, 1443857720, 1560382517, 1075025698, 1260232239, 575138148, 692707433, 878443390, 1062597235, 243256656, 91341917, 409198410, 325965383, 3403100636, 3252238545, 3704300486, 3620022987, 3874428392, 3990953189, 4042459122, 4227665663, 2460449204, 2578018489, 2226875310, 2411029155, 3198115200, 3046200461, 2827177882, 2743944855];
var U3 = [0, 218828297, 437656594, 387781147, 875313188, 958871085, 775562294, 590424639, 1750626376, 1699970625, 1917742170, 2135253587, 1551124588, 1367295589, 1180849278, 1265195639, 3501252752, 3720081049, 3399941250, 3350065803, 3835484340, 3919042237, 4270507174, 4085369519, 3102249176, 3051593425, 2734591178, 2952102595, 2361698556, 2177869557, 2530391278, 2614737639, 3145456443, 3060847922, 2708326185, 2892417312, 2404901663, 2187128086, 2504130317, 2555048196, 3542330227, 3727205754, 3375740769, 3292445032, 3876557655, 3926170974, 4246310725, 4027744588, 1808481195, 1723872674, 1910319033, 2094410160, 1608975247, 1391201670, 1173430173, 1224348052, 59984867, 244860394, 428169201, 344873464, 935293895, 984907214, 766078933, 547512796, 1844882806, 1627235199, 2011214180, 2062270317, 1507497298, 1423022939, 1137477952, 1321699145, 95345982, 145085239, 532201772, 313773861, 830661914, 1015671571, 731183368, 648017665, 3175501286, 2957853679, 2807058932, 2858115069, 2305455554, 2220981195, 2474404304, 2658625497, 3575528878, 3625268135, 3473416636, 3254988725, 3778151818, 3963161475, 4213447064, 4130281361, 3599595085, 3683022916, 3432737375, 3247465558, 3802222185, 4020912224, 4172763771, 4122762354, 3201631749, 3017672716, 2764249623, 2848461854, 2331590177, 2280796200, 2431590963, 2648976442, 104699613, 188127444, 472615631, 287343814, 840019705, 1058709744, 671593195, 621591778, 1852171925, 1668212892, 1953757831, 2037970062, 1514790577, 1463996600, 1080017571, 1297403050, 3673637356, 3623636965, 3235995134, 3454686199, 4007360968, 3822090177, 4107101658, 4190530515, 2997825956, 3215212461, 2830708150, 2779915199, 2256734592, 2340947849, 2627016082, 2443058075, 172466556, 122466165, 273792366, 492483431, 1047239e3, 861968209, 612205898, 695634755, 1646252340, 1863638845, 2013908262, 1963115311, 1446242576, 1530455833, 1277555970, 1093597963, 1636604631, 1820824798, 2073724613, 1989249228, 1436590835, 1487645946, 1337376481, 1119727848, 164948639, 81781910, 331544205, 516552836, 1039717051, 821288114, 669961897, 719700128, 2973530695, 3157750862, 2871682645, 2787207260, 2232435299, 2283490410, 2667994737, 2450346104, 3647212047, 3564045318, 3279033885, 3464042516, 3980931627, 3762502690, 4150144569, 4199882800, 3070356634, 3121275539, 2904027272, 2686254721, 2200818878, 2384911031, 2570832044, 2486224549, 3747192018, 3528626907, 3310321856, 3359936201, 3950355702, 3867060991, 4049844452, 4234721005, 1739656202, 1790575107, 2108100632, 1890328081, 1402811438, 1586903591, 1233856572, 1149249077, 266959938, 48394827, 369057872, 418672217, 1002783846, 919489135, 567498868, 752375421, 209336225, 24197544, 376187827, 459744698, 945164165, 895287692, 574624663, 793451934, 1679968233, 1764313568, 2117360635, 1933530610, 1343127501, 1560637892, 1243112415, 1192455638, 3704280881, 3519142200, 3336358691, 3419915562, 3907448597, 3857572124, 4075877127, 4294704398, 3029510009, 3113855344, 2927934315, 2744104290, 2159976285, 2377486676, 2594734927, 2544078150];
var U4 = [0, 151849742, 303699484, 454499602, 607398968, 758720310, 908999204, 1059270954, 1214797936, 1097159550, 1517440620, 1400849762, 1817998408, 1699839814, 2118541908, 2001430874, 2429595872, 2581445614, 2194319100, 2345119218, 3034881240, 3186202582, 2801699524, 2951971274, 3635996816, 3518358430, 3399679628, 3283088770, 4237083816, 4118925222, 4002861748, 3885750714, 1002142683, 850817237, 698445255, 548169417, 529487843, 377642221, 227885567, 77089521, 1943217067, 2061379749, 1640576439, 1757691577, 1474760595, 1592394909, 1174215055, 1290801793, 2875968315, 2724642869, 3111247143, 2960971305, 2405426947, 2253581325, 2638606623, 2487810577, 3808662347, 3926825029, 4044981591, 4162096729, 3342319475, 3459953789, 3576539503, 3693126241, 1986918061, 2137062819, 1685577905, 1836772287, 1381620373, 1532285339, 1078185097, 1229899655, 1040559837, 923313619, 740276417, 621982671, 439452389, 322734571, 137073913, 19308535, 3871163981, 4021308739, 4104605777, 4255800159, 3263785589, 3414450555, 3499326569, 3651041127, 2933202493, 2815956275, 3167684641, 3049390895, 2330014213, 2213296395, 2566595609, 2448830231, 1305906550, 1155237496, 1607244650, 1455525988, 1776460110, 1626319424, 2079897426, 1928707164, 96392454, 213114376, 396673818, 514443284, 562755902, 679998e3, 865136418, 983426092, 3708173718, 3557504664, 3474729866, 3323011204, 4180808110, 4030667424, 3945269170, 3794078908, 2507040230, 2623762152, 2272556026, 2390325492, 2975484382, 3092726480, 2738905026, 2857194700, 3973773121, 3856137295, 4274053469, 4157467219, 3371096953, 3252932727, 3673476453, 3556361835, 2763173681, 2915017791, 3064510765, 3215307299, 2156299017, 2307622919, 2459735317, 2610011675, 2081048481, 1963412655, 1846563261, 1729977011, 1480485785, 1362321559, 1243905413, 1126790795, 878845905, 1030690015, 645401037, 796197571, 274084841, 425408743, 38544885, 188821243, 3613494426, 3731654548, 3313212038, 3430322568, 4082475170, 4200115116, 3780097726, 3896688048, 2668221674, 2516901860, 2366882550, 2216610296, 3141400786, 2989552604, 2837966542, 2687165888, 1202797690, 1320957812, 1437280870, 1554391400, 1669664834, 1787304780, 1906247262, 2022837584, 265905162, 114585348, 499347990, 349075736, 736970802, 585122620, 972512814, 821712160, 2595684844, 2478443234, 2293045232, 2174754046, 3196267988, 3079546586, 2895723464, 2777952454, 3537852828, 3687994002, 3234156416, 3385345166, 4142626212, 4293295786, 3841024952, 3992742070, 174567692, 57326082, 410887952, 292596766, 777231668, 660510266, 1011452712, 893681702, 1108339068, 1258480242, 1343618912, 1494807662, 1715193156, 1865862730, 1948373848, 2100090966, 2701949495, 2818666809, 3004591147, 3122358053, 2235061775, 2352307457, 2535604243, 2653899549, 3915653703, 3764988233, 4219352155, 4067639125, 3444575871, 3294430577, 3746175075, 3594982253, 836553431, 953270745, 600235211, 718002117, 367585007, 484830689, 133361907, 251657213, 2041877159, 1891211689, 1806599355, 1654886325, 1568718495, 1418573201, 1335535747, 1184342925];
function convertToInt32(bytes2) {
  const result2 = [];
  for (let i = 0; i < bytes2.length; i += 4) {
    result2.push(bytes2[i] << 24 | bytes2[i + 1] << 16 | bytes2[i + 2] << 8 | bytes2[i + 3]);
  }
  return result2;
}
var AES = class _AES {
  get key() {
    return __classPrivateFieldGet(this, _AES_key, "f").slice();
  }
  constructor(key) {
    _AES_key.set(this, void 0);
    _AES_Kd.set(this, void 0);
    _AES_Ke.set(this, void 0);
    if (!(this instanceof _AES)) {
      throw Error("AES must be instanitated with `new`");
    }
    __classPrivateFieldSet(this, _AES_key, new Uint8Array(key), "f");
    const rounds = numberOfRounds[this.key.length];
    if (rounds == null) {
      throw new TypeError("invalid key size (must be 16, 24 or 32 bytes)");
    }
    __classPrivateFieldSet(this, _AES_Ke, [], "f");
    __classPrivateFieldSet(this, _AES_Kd, [], "f");
    for (let i = 0; i <= rounds; i++) {
      __classPrivateFieldGet(this, _AES_Ke, "f").push([0, 0, 0, 0]);
      __classPrivateFieldGet(this, _AES_Kd, "f").push([0, 0, 0, 0]);
    }
    const roundKeyCount = (rounds + 1) * 4;
    const KC = this.key.length / 4;
    const tk = convertToInt32(this.key);
    let index;
    for (let i = 0; i < KC; i++) {
      index = i >> 2;
      __classPrivateFieldGet(this, _AES_Ke, "f")[index][i % 4] = tk[i];
      __classPrivateFieldGet(this, _AES_Kd, "f")[rounds - index][i % 4] = tk[i];
    }
    let rconpointer = 0;
    let t = KC, tt;
    while (t < roundKeyCount) {
      tt = tk[KC - 1];
      tk[0] ^= S[tt >> 16 & 255] << 24 ^ S[tt >> 8 & 255] << 16 ^ S[tt & 255] << 8 ^ S[tt >> 24 & 255] ^ rcon[rconpointer] << 24;
      rconpointer += 1;
      if (KC != 8) {
        for (let i2 = 1; i2 < KC; i2++) {
          tk[i2] ^= tk[i2 - 1];
        }
      } else {
        for (let i2 = 1; i2 < KC / 2; i2++) {
          tk[i2] ^= tk[i2 - 1];
        }
        tt = tk[KC / 2 - 1];
        tk[KC / 2] ^= S[tt & 255] ^ S[tt >> 8 & 255] << 8 ^ S[tt >> 16 & 255] << 16 ^ S[tt >> 24 & 255] << 24;
        for (let i2 = KC / 2 + 1; i2 < KC; i2++) {
          tk[i2] ^= tk[i2 - 1];
        }
      }
      let i = 0, r, c;
      while (i < KC && t < roundKeyCount) {
        r = t >> 2;
        c = t % 4;
        __classPrivateFieldGet(this, _AES_Ke, "f")[r][c] = tk[i];
        __classPrivateFieldGet(this, _AES_Kd, "f")[rounds - r][c] = tk[i++];
        t++;
      }
    }
    for (let r = 1; r < rounds; r++) {
      for (let c = 0; c < 4; c++) {
        tt = __classPrivateFieldGet(this, _AES_Kd, "f")[r][c];
        __classPrivateFieldGet(this, _AES_Kd, "f")[r][c] = U1[tt >> 24 & 255] ^ U2[tt >> 16 & 255] ^ U3[tt >> 8 & 255] ^ U4[tt & 255];
      }
    }
  }
  encrypt(plaintext) {
    if (plaintext.length != 16) {
      throw new TypeError("invalid plaintext size (must be 16 bytes)");
    }
    const rounds = __classPrivateFieldGet(this, _AES_Ke, "f").length - 1;
    const a = [0, 0, 0, 0];
    let t = convertToInt32(plaintext);
    for (let i = 0; i < 4; i++) {
      t[i] ^= __classPrivateFieldGet(this, _AES_Ke, "f")[0][i];
    }
    for (let r = 1; r < rounds; r++) {
      for (let i = 0; i < 4; i++) {
        a[i] = T12[t[i] >> 24 & 255] ^ T2[t[(i + 1) % 4] >> 16 & 255] ^ T3[t[(i + 2) % 4] >> 8 & 255] ^ T4[t[(i + 3) % 4] & 255] ^ __classPrivateFieldGet(this, _AES_Ke, "f")[r][i];
      }
      t = a.slice();
    }
    const result2 = new Uint8Array(16);
    let tt = 0;
    for (let i = 0; i < 4; i++) {
      tt = __classPrivateFieldGet(this, _AES_Ke, "f")[rounds][i];
      result2[4 * i] = (S[t[i] >> 24 & 255] ^ tt >> 24) & 255;
      result2[4 * i + 1] = (S[t[(i + 1) % 4] >> 16 & 255] ^ tt >> 16) & 255;
      result2[4 * i + 2] = (S[t[(i + 2) % 4] >> 8 & 255] ^ tt >> 8) & 255;
      result2[4 * i + 3] = (S[t[(i + 3) % 4] & 255] ^ tt) & 255;
    }
    return result2;
  }
  decrypt(ciphertext) {
    if (ciphertext.length != 16) {
      throw new TypeError("invalid ciphertext size (must be 16 bytes)");
    }
    const rounds = __classPrivateFieldGet(this, _AES_Kd, "f").length - 1;
    const a = [0, 0, 0, 0];
    let t = convertToInt32(ciphertext);
    for (let i = 0; i < 4; i++) {
      t[i] ^= __classPrivateFieldGet(this, _AES_Kd, "f")[0][i];
    }
    for (let r = 1; r < rounds; r++) {
      for (let i = 0; i < 4; i++) {
        a[i] = T5[t[i] >> 24 & 255] ^ T6[t[(i + 3) % 4] >> 16 & 255] ^ T7[t[(i + 2) % 4] >> 8 & 255] ^ T8[t[(i + 1) % 4] & 255] ^ __classPrivateFieldGet(this, _AES_Kd, "f")[r][i];
      }
      t = a.slice();
    }
    const result2 = new Uint8Array(16);
    let tt = 0;
    for (let i = 0; i < 4; i++) {
      tt = __classPrivateFieldGet(this, _AES_Kd, "f")[rounds][i];
      result2[4 * i] = (Si[t[i] >> 24 & 255] ^ tt >> 24) & 255;
      result2[4 * i + 1] = (Si[t[(i + 3) % 4] >> 16 & 255] ^ tt >> 16) & 255;
      result2[4 * i + 2] = (Si[t[(i + 2) % 4] >> 8 & 255] ^ tt >> 8) & 255;
      result2[4 * i + 3] = (Si[t[(i + 1) % 4] & 255] ^ tt) & 255;
    }
    return result2;
  }
};
_AES_key = /* @__PURE__ */ new WeakMap(), _AES_Kd = /* @__PURE__ */ new WeakMap(), _AES_Ke = /* @__PURE__ */ new WeakMap();

// node_modules/aes-js/lib.esm/mode.js
var ModeOfOperation = class {
  constructor(name, key, cls) {
    if (cls && !(this instanceof cls)) {
      throw new Error(`${name} must be instantiated with "new"`);
    }
    Object.defineProperties(this, {
      aes: { enumerable: true, value: new AES(key) },
      name: { enumerable: true, value: name }
    });
  }
};

// node_modules/aes-js/lib.esm/mode-cbc.js
var __classPrivateFieldSet2 = function(receiver, state, value, kind, f2) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f2.call(receiver, value) : f2 ? f2.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet2 = function(receiver, state, kind, f2) {
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
};
var _CBC_iv;
var _CBC_lastBlock;
var CBC = class _CBC extends ModeOfOperation {
  constructor(key, iv) {
    super("ECC", key, _CBC);
    _CBC_iv.set(this, void 0);
    _CBC_lastBlock.set(this, void 0);
    if (iv) {
      if (iv.length % 16) {
        throw new TypeError("invalid iv size (must be 16 bytes)");
      }
      __classPrivateFieldSet2(this, _CBC_iv, new Uint8Array(iv), "f");
    } else {
      __classPrivateFieldSet2(this, _CBC_iv, new Uint8Array(16), "f");
    }
    __classPrivateFieldSet2(this, _CBC_lastBlock, this.iv, "f");
  }
  get iv() {
    return new Uint8Array(__classPrivateFieldGet2(this, _CBC_iv, "f"));
  }
  encrypt(plaintext) {
    if (plaintext.length % 16) {
      throw new TypeError("invalid plaintext size (must be multiple of 16 bytes)");
    }
    const ciphertext = new Uint8Array(plaintext.length);
    for (let i = 0; i < plaintext.length; i += 16) {
      for (let j = 0; j < 16; j++) {
        __classPrivateFieldGet2(this, _CBC_lastBlock, "f")[j] ^= plaintext[i + j];
      }
      __classPrivateFieldSet2(this, _CBC_lastBlock, this.aes.encrypt(__classPrivateFieldGet2(this, _CBC_lastBlock, "f")), "f");
      ciphertext.set(__classPrivateFieldGet2(this, _CBC_lastBlock, "f"), i);
    }
    return ciphertext;
  }
  decrypt(ciphertext) {
    if (ciphertext.length % 16) {
      throw new TypeError("invalid ciphertext size (must be multiple of 16 bytes)");
    }
    const plaintext = new Uint8Array(ciphertext.length);
    for (let i = 0; i < ciphertext.length; i += 16) {
      const block = this.aes.decrypt(ciphertext.subarray(i, i + 16));
      for (let j = 0; j < 16; j++) {
        plaintext[i + j] = block[j] ^ __classPrivateFieldGet2(this, _CBC_lastBlock, "f")[j];
        __classPrivateFieldGet2(this, _CBC_lastBlock, "f")[j] = ciphertext[i + j];
      }
    }
    return plaintext;
  }
};
_CBC_iv = /* @__PURE__ */ new WeakMap(), _CBC_lastBlock = /* @__PURE__ */ new WeakMap();

// node_modules/aes-js/lib.esm/mode-cfb.js
var __classPrivateFieldGet3 = function(receiver, state, kind, f2) {
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
};
var _CFB_instances;
var _CFB_iv;
var _CFB_shiftRegister;
var _CFB_shift;
_CFB_iv = /* @__PURE__ */ new WeakMap(), _CFB_shiftRegister = /* @__PURE__ */ new WeakMap(), _CFB_instances = /* @__PURE__ */ new WeakSet(), _CFB_shift = function _CFB_shift2(data) {
  const segmentSize = this.segmentSize / 8;
  __classPrivateFieldGet3(this, _CFB_shiftRegister, "f").set(__classPrivateFieldGet3(this, _CFB_shiftRegister, "f").subarray(segmentSize));
  __classPrivateFieldGet3(this, _CFB_shiftRegister, "f").set(data.subarray(0, segmentSize), 16 - segmentSize);
};

// node_modules/aes-js/lib.esm/mode-ctr.js
var __classPrivateFieldSet3 = function(receiver, state, value, kind, f2) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f2.call(receiver, value) : f2 ? f2.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet4 = function(receiver, state, kind, f2) {
  if (kind === "a" && !f2)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
};
var _CTR_remaining;
var _CTR_remainingIndex;
var _CTR_counter;
var CTR = class _CTR extends ModeOfOperation {
  constructor(key, initialValue) {
    super("CTR", key, _CTR);
    _CTR_remaining.set(this, void 0);
    _CTR_remainingIndex.set(this, void 0);
    _CTR_counter.set(this, void 0);
    __classPrivateFieldSet3(this, _CTR_counter, new Uint8Array(16), "f");
    __classPrivateFieldGet4(this, _CTR_counter, "f").fill(0);
    __classPrivateFieldSet3(this, _CTR_remaining, __classPrivateFieldGet4(this, _CTR_counter, "f"), "f");
    __classPrivateFieldSet3(this, _CTR_remainingIndex, 16, "f");
    if (initialValue == null) {
      initialValue = 1;
    }
    if (typeof initialValue === "number") {
      this.setCounterValue(initialValue);
    } else {
      this.setCounterBytes(initialValue);
    }
  }
  get counter() {
    return new Uint8Array(__classPrivateFieldGet4(this, _CTR_counter, "f"));
  }
  setCounterValue(value) {
    if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new TypeError("invalid counter initial integer value");
    }
    for (let index = 15; index >= 0; --index) {
      __classPrivateFieldGet4(this, _CTR_counter, "f")[index] = value % 256;
      value = Math.floor(value / 256);
    }
  }
  setCounterBytes(value) {
    if (value.length !== 16) {
      throw new TypeError("invalid counter initial Uint8Array value length");
    }
    __classPrivateFieldGet4(this, _CTR_counter, "f").set(value);
  }
  increment() {
    for (let i = 15; i >= 0; i--) {
      if (__classPrivateFieldGet4(this, _CTR_counter, "f")[i] === 255) {
        __classPrivateFieldGet4(this, _CTR_counter, "f")[i] = 0;
      } else {
        __classPrivateFieldGet4(this, _CTR_counter, "f")[i]++;
        break;
      }
    }
  }
  encrypt(plaintext) {
    var _a, _b;
    const crypttext = new Uint8Array(plaintext);
    for (let i = 0; i < crypttext.length; i++) {
      if (__classPrivateFieldGet4(this, _CTR_remainingIndex, "f") === 16) {
        __classPrivateFieldSet3(this, _CTR_remaining, this.aes.encrypt(__classPrivateFieldGet4(this, _CTR_counter, "f")), "f");
        __classPrivateFieldSet3(this, _CTR_remainingIndex, 0, "f");
        this.increment();
      }
      crypttext[i] ^= __classPrivateFieldGet4(this, _CTR_remaining, "f")[__classPrivateFieldSet3(this, _CTR_remainingIndex, (_b = __classPrivateFieldGet4(this, _CTR_remainingIndex, "f"), _a = _b++, _b), "f"), _a];
    }
    return crypttext;
  }
  decrypt(ciphertext) {
    return this.encrypt(ciphertext);
  }
};
_CTR_remaining = /* @__PURE__ */ new WeakMap(), _CTR_remainingIndex = /* @__PURE__ */ new WeakMap(), _CTR_counter = /* @__PURE__ */ new WeakMap();

// node_modules/aes-js/lib.esm/mode-ofb.js
var _OFB_iv;
var _OFB_lastPrecipher;
var _OFB_lastPrecipherIndex;
_OFB_iv = /* @__PURE__ */ new WeakMap(), _OFB_lastPrecipher = /* @__PURE__ */ new WeakMap(), _OFB_lastPrecipherIndex = /* @__PURE__ */ new WeakMap();

// node_modules/aes-js/lib.esm/padding.js
function pkcs7Strip(data) {
  if (data.length < 16) {
    throw new TypeError("PKCS#7 invalid length");
  }
  const padder = data[data.length - 1];
  if (padder > 16) {
    throw new TypeError("PKCS#7 padding byte out of range");
  }
  const length = data.length - padder;
  for (let i = 0; i < padder; i++) {
    if (data[length + i] !== padder) {
      throw new TypeError("PKCS#7 invalid padding byte");
    }
  }
  return new Uint8Array(data.subarray(0, length));
}

// node_modules/ethers/lib.esm/wallet/utils.js
function looseArrayify(hexString) {
  if (typeof hexString === "string" && !hexString.startsWith("0x")) {
    hexString = "0x" + hexString;
  }
  return getBytesCopy(hexString);
}
function zpad(value, length) {
  value = String(value);
  while (value.length < length) {
    value = "0" + value;
  }
  return value;
}
function getPassword(password) {
  if (typeof password === "string") {
    return toUtf8Bytes(password, "NFKC");
  }
  return getBytesCopy(password);
}
function spelunk(object2, _path) {
  const match = _path.match(/^([a-z0-9$_.-]*)(:([a-z]+))?(!)?$/i);
  assertArgument(match != null, "invalid path", "path", _path);
  const path2 = match[1];
  const type = match[3];
  const reqd = match[4] === "!";
  let cur = object2;
  for (const comp of path2.toLowerCase().split(".")) {
    if (Array.isArray(cur)) {
      if (!comp.match(/^[0-9]+$/)) {
        break;
      }
      cur = cur[parseInt(comp)];
    } else if (typeof cur === "object") {
      let found = null;
      for (const key in cur) {
        if (key.toLowerCase() === comp) {
          found = cur[key];
          break;
        }
      }
      cur = found;
    } else {
      cur = null;
    }
    if (cur == null) {
      break;
    }
  }
  assertArgument(!reqd || cur != null, "missing required value", "path", path2);
  if (type && cur != null) {
    if (type === "int") {
      if (typeof cur === "string" && cur.match(/^-?[0-9]+$/)) {
        return parseInt(cur);
      } else if (Number.isSafeInteger(cur)) {
        return cur;
      }
    }
    if (type === "number") {
      if (typeof cur === "string" && cur.match(/^-?[0-9.]*$/)) {
        return parseFloat(cur);
      }
    }
    if (type === "data") {
      if (typeof cur === "string") {
        return looseArrayify(cur);
      }
    }
    if (type === "array" && Array.isArray(cur)) {
      return cur;
    }
    if (type === typeof cur) {
      return cur;
    }
    assertArgument(false, `wrong type found for ${type} `, "path", path2);
  }
  return cur;
}

// node_modules/ethers/lib.esm/wallet/json-keystore.js
var defaultPath = "m/44'/60'/0'/0/0";
function isKeystoreJson(json) {
  try {
    const data = JSON.parse(json);
    const version2 = data.version != null ? parseInt(data.version) : 0;
    if (version2 === 3) {
      return true;
    }
  } catch (error) {
  }
  return false;
}
function decrypt(data, key, ciphertext) {
  const cipher = spelunk(data, "crypto.cipher:string");
  if (cipher === "aes-128-ctr") {
    const iv = spelunk(data, "crypto.cipherparams.iv:data!");
    const aesCtr = new CTR(key, iv);
    return hexlify(aesCtr.decrypt(ciphertext));
  }
  assert(false, "unsupported cipher", "UNSUPPORTED_OPERATION", {
    operation: "decrypt"
  });
}
function getAccount(data, _key) {
  const key = getBytes(_key);
  const ciphertext = spelunk(data, "crypto.ciphertext:data!");
  const computedMAC = hexlify(keccak256(concat([key.slice(16, 32), ciphertext]))).substring(2);
  assertArgument(computedMAC === spelunk(data, "crypto.mac:string!").toLowerCase(), "incorrect password", "password", "[ REDACTED ]");
  const privateKey = decrypt(data, key.slice(0, 16), ciphertext);
  const address = computeAddress(privateKey);
  if (data.address) {
    let check = data.address.toLowerCase();
    if (!check.startsWith("0x")) {
      check = "0x" + check;
    }
    assertArgument(getAddress(check) === address, "keystore address/privateKey mismatch", "address", data.address);
  }
  const account = { address, privateKey };
  const version2 = spelunk(data, "x-ethers.version:string");
  if (version2 === "0.1") {
    const mnemonicKey = key.slice(32, 64);
    const mnemonicCiphertext = spelunk(data, "x-ethers.mnemonicCiphertext:data!");
    const mnemonicIv = spelunk(data, "x-ethers.mnemonicCounter:data!");
    const mnemonicAesCtr = new CTR(mnemonicKey, mnemonicIv);
    account.mnemonic = {
      path: spelunk(data, "x-ethers.path:string") || defaultPath,
      locale: spelunk(data, "x-ethers.locale:string") || "en",
      entropy: hexlify(getBytes(mnemonicAesCtr.decrypt(mnemonicCiphertext)))
    };
  }
  return account;
}
function getDecryptKdfParams(data) {
  const kdf = spelunk(data, "crypto.kdf:string");
  if (kdf && typeof kdf === "string") {
    if (kdf.toLowerCase() === "scrypt") {
      const salt = spelunk(data, "crypto.kdfparams.salt:data!");
      const N2 = spelunk(data, "crypto.kdfparams.n:int!");
      const r = spelunk(data, "crypto.kdfparams.r:int!");
      const p = spelunk(data, "crypto.kdfparams.p:int!");
      assertArgument(N2 > 0 && (N2 & N2 - 1) === 0, "invalid kdf.N", "kdf.N", N2);
      assertArgument(r > 0 && p > 0, "invalid kdf", "kdf", kdf);
      const dkLen = spelunk(data, "crypto.kdfparams.dklen:int!");
      assertArgument(dkLen === 32, "invalid kdf.dklen", "kdf.dflen", dkLen);
      return { name: "scrypt", salt, N: N2, r, p, dkLen: 64 };
    } else if (kdf.toLowerCase() === "pbkdf2") {
      const salt = spelunk(data, "crypto.kdfparams.salt:data!");
      const prf = spelunk(data, "crypto.kdfparams.prf:string!");
      const algorithm = prf.split("-").pop();
      assertArgument(algorithm === "sha256" || algorithm === "sha512", "invalid kdf.pdf", "kdf.pdf", prf);
      const count = spelunk(data, "crypto.kdfparams.c:int!");
      const dkLen = spelunk(data, "crypto.kdfparams.dklen:int!");
      assertArgument(dkLen === 32, "invalid kdf.dklen", "kdf.dklen", dkLen);
      return { name: "pbkdf2", salt, count, dkLen, algorithm };
    }
  }
  assertArgument(false, "unsupported key-derivation function", "kdf", kdf);
}
function decryptKeystoreJsonSync(json, _password) {
  const data = JSON.parse(json);
  const password = getPassword(_password);
  const params = getDecryptKdfParams(data);
  if (params.name === "pbkdf2") {
    const { salt: salt2, count, dkLen: dkLen2, algorithm } = params;
    const key2 = pbkdf2(password, salt2, count, dkLen2, algorithm);
    return getAccount(data, key2);
  }
  assert(params.name === "scrypt", "cannot be reached", "UNKNOWN_ERROR", { params });
  const { salt, N: N2, r, p, dkLen } = params;
  const key = scryptSync(password, salt, N2, r, p, dkLen);
  return getAccount(data, key);
}
function stall3(duration) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}
async function decryptKeystoreJson(json, _password, progress) {
  const data = JSON.parse(json);
  const password = getPassword(_password);
  const params = getDecryptKdfParams(data);
  if (params.name === "pbkdf2") {
    if (progress) {
      progress(0);
      await stall3(0);
    }
    const { salt: salt2, count, dkLen: dkLen2, algorithm } = params;
    const key2 = pbkdf2(password, salt2, count, dkLen2, algorithm);
    if (progress) {
      progress(1);
      await stall3(0);
    }
    return getAccount(data, key2);
  }
  assert(params.name === "scrypt", "cannot be reached", "UNKNOWN_ERROR", { params });
  const { salt, N: N2, r, p, dkLen } = params;
  const key = await scrypt2(password, salt, N2, r, p, dkLen, progress);
  return getAccount(data, key);
}
function getEncryptKdfParams(options2) {
  const salt = options2.salt != null ? getBytes(options2.salt, "options.salt") : randomBytes3(32);
  let N2 = 1 << 17, r = 8, p = 1;
  if (options2.scrypt) {
    if (options2.scrypt.N) {
      N2 = options2.scrypt.N;
    }
    if (options2.scrypt.r) {
      r = options2.scrypt.r;
    }
    if (options2.scrypt.p) {
      p = options2.scrypt.p;
    }
  }
  assertArgument(typeof N2 === "number" && N2 > 0 && Number.isSafeInteger(N2) && (BigInt(N2) & BigInt(N2 - 1)) === BigInt(0), "invalid scrypt N parameter", "options.N", N2);
  assertArgument(typeof r === "number" && r > 0 && Number.isSafeInteger(r), "invalid scrypt r parameter", "options.r", r);
  assertArgument(typeof p === "number" && p > 0 && Number.isSafeInteger(p), "invalid scrypt p parameter", "options.p", p);
  return { name: "scrypt", dkLen: 32, salt, N: N2, r, p };
}
function _encryptKeystore(key, kdf, account, options2) {
  const privateKey = getBytes(account.privateKey, "privateKey");
  const iv = options2.iv != null ? getBytes(options2.iv, "options.iv") : randomBytes3(16);
  assertArgument(iv.length === 16, "invalid options.iv length", "options.iv", options2.iv);
  const uuidRandom = options2.uuid != null ? getBytes(options2.uuid, "options.uuid") : randomBytes3(16);
  assertArgument(uuidRandom.length === 16, "invalid options.uuid length", "options.uuid", options2.iv);
  const derivedKey = key.slice(0, 16);
  const macPrefix = key.slice(16, 32);
  const aesCtr = new CTR(derivedKey, iv);
  const ciphertext = getBytes(aesCtr.encrypt(privateKey));
  const mac = keccak256(concat([macPrefix, ciphertext]));
  const data = {
    address: account.address.substring(2).toLowerCase(),
    id: uuidV4(uuidRandom),
    version: 3,
    Crypto: {
      cipher: "aes-128-ctr",
      cipherparams: {
        iv: hexlify(iv).substring(2)
      },
      ciphertext: hexlify(ciphertext).substring(2),
      kdf: "scrypt",
      kdfparams: {
        salt: hexlify(kdf.salt).substring(2),
        n: kdf.N,
        dklen: 32,
        p: kdf.p,
        r: kdf.r
      },
      mac: mac.substring(2)
    }
  };
  if (account.mnemonic) {
    const client = options2.client != null ? options2.client : `ethers/${version}`;
    const path2 = account.mnemonic.path || defaultPath;
    const locale = account.mnemonic.locale || "en";
    const mnemonicKey = key.slice(32, 64);
    const entropy = getBytes(account.mnemonic.entropy, "account.mnemonic.entropy");
    const mnemonicIv = randomBytes3(16);
    const mnemonicAesCtr = new CTR(mnemonicKey, mnemonicIv);
    const mnemonicCiphertext = getBytes(mnemonicAesCtr.encrypt(entropy));
    const now = /* @__PURE__ */ new Date();
    const timestamp = now.getUTCFullYear() + "-" + zpad(now.getUTCMonth() + 1, 2) + "-" + zpad(now.getUTCDate(), 2) + "T" + zpad(now.getUTCHours(), 2) + "-" + zpad(now.getUTCMinutes(), 2) + "-" + zpad(now.getUTCSeconds(), 2) + ".0Z";
    const gethFilename = "UTC--" + timestamp + "--" + data.address;
    data["x-ethers"] = {
      client,
      gethFilename,
      path: path2,
      locale,
      mnemonicCounter: hexlify(mnemonicIv).substring(2),
      mnemonicCiphertext: hexlify(mnemonicCiphertext).substring(2),
      version: "0.1"
    };
  }
  return JSON.stringify(data);
}
function encryptKeystoreJsonSync(account, password, options2) {
  if (options2 == null) {
    options2 = {};
  }
  const passwordBytes = getPassword(password);
  const kdf = getEncryptKdfParams(options2);
  const key = scryptSync(passwordBytes, kdf.salt, kdf.N, kdf.r, kdf.p, 64);
  return _encryptKeystore(getBytes(key), kdf, account, options2);
}
async function encryptKeystoreJson(account, password, options2) {
  if (options2 == null) {
    options2 = {};
  }
  const passwordBytes = getPassword(password);
  const kdf = getEncryptKdfParams(options2);
  const key = await scrypt2(passwordBytes, kdf.salt, kdf.N, kdf.r, kdf.p, 64, options2.progressCallback);
  return _encryptKeystore(getBytes(key), kdf, account, options2);
}

// node_modules/ethers/lib.esm/wallet/hdwallet.js
var defaultPath2 = "m/44'/60'/0'/0/0";
var MasterSecret = new Uint8Array([66, 105, 116, 99, 111, 105, 110, 32, 115, 101, 101, 100]);
var HardenedBit = 2147483648;
var N = BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141");
var Nibbles2 = "0123456789abcdef";
function zpad2(value, length) {
  let result2 = "";
  while (value) {
    result2 = Nibbles2[value % 16] + result2;
    value = Math.trunc(value / 16);
  }
  while (result2.length < length * 2) {
    result2 = "0" + result2;
  }
  return "0x" + result2;
}
function encodeBase58Check(_value) {
  const value = getBytes(_value);
  const check = dataSlice(sha2562(sha2562(value)), 0, 4);
  const bytes2 = concat([value, check]);
  return encodeBase58(bytes2);
}
var _guard6 = {};
function ser_I(index, chainCode, publicKey, privateKey) {
  const data = new Uint8Array(37);
  if (index & HardenedBit) {
    assert(privateKey != null, "cannot derive child of neutered node", "UNSUPPORTED_OPERATION", {
      operation: "deriveChild"
    });
    data.set(getBytes(privateKey), 1);
  } else {
    data.set(getBytes(publicKey));
  }
  for (let i = 24; i >= 0; i -= 8) {
    data[33 + (i >> 3)] = index >> 24 - i & 255;
  }
  const I = getBytes(computeHmac("sha512", chainCode, data));
  return { IL: I.slice(0, 32), IR: I.slice(32) };
}
function derivePath(node, path2) {
  const components = path2.split("/");
  assertArgument(components.length > 0, "invalid path", "path", path2);
  if (components[0] === "m") {
    assertArgument(node.depth === 0, `cannot derive root path (i.e. path starting with "m/") for a node at non-zero depth ${node.depth}`, "path", path2);
    components.shift();
  }
  let result2 = node;
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    if (component.match(/^[0-9]+'$/)) {
      const index = parseInt(component.substring(0, component.length - 1));
      assertArgument(index < HardenedBit, "invalid path index", `path[${i}]`, component);
      result2 = result2.deriveChild(HardenedBit + index);
    } else if (component.match(/^[0-9]+$/)) {
      const index = parseInt(component);
      assertArgument(index < HardenedBit, "invalid path index", `path[${i}]`, component);
      result2 = result2.deriveChild(index);
    } else {
      assertArgument(false, "invalid path component", `path[${i}]`, component);
    }
  }
  return result2;
}
var HDNodeWallet = class _HDNodeWallet extends BaseWallet {
  /**
   *  The compressed public key.
   */
  publicKey;
  /**
   *  The fingerprint.
   *
   *  A fingerprint allows quick qay to detect parent and child nodes,
   *  but developers should be prepared to deal with collisions as it
   *  is only 4 bytes.
   */
  fingerprint;
  /**
   *  The parent fingerprint.
   */
  parentFingerprint;
  /**
   *  The mnemonic used to create this HD Node, if available.
   *
   *  Sources such as extended keys do not encode the mnemonic, in
   *  which case this will be ``null``.
   */
  mnemonic;
  /**
   *  The chaincode, which is effectively a public key used
   *  to derive children.
   */
  chainCode;
  /**
   *  The derivation path of this wallet.
   *
   *  Since extended keys do not provide full path details, this
   *  may be ``null``, if instantiated from a source that does not
   *  encode it.
   */
  path;
  /**
   *  The child index of this wallet. Values over ``2 *\* 31`` indicate
   *  the node is hardened.
   */
  index;
  /**
   *  The depth of this wallet, which is the number of components
   *  in its path.
   */
  depth;
  /**
   *  @private
   */
  constructor(guard, signingKey, parentFingerprint, chainCode, path2, index, depth, mnemonic, provider) {
    super(signingKey, provider);
    assertPrivate(guard, _guard6, "HDNodeWallet");
    defineProperties(this, { publicKey: signingKey.compressedPublicKey });
    const fingerprint = dataSlice(ripemd1602(sha2562(this.publicKey)), 0, 4);
    defineProperties(this, {
      parentFingerprint,
      fingerprint,
      chainCode,
      path: path2,
      index,
      depth
    });
    defineProperties(this, { mnemonic });
  }
  connect(provider) {
    return new _HDNodeWallet(_guard6, this.signingKey, this.parentFingerprint, this.chainCode, this.path, this.index, this.depth, this.mnemonic, provider);
  }
  #account() {
    const account = { address: this.address, privateKey: this.privateKey };
    const m = this.mnemonic;
    if (this.path && m && m.wordlist.locale === "en" && m.password === "") {
      account.mnemonic = {
        path: this.path,
        locale: "en",
        entropy: m.entropy
      };
    }
    return account;
  }
  /**
   *  Resolves to a [JSON Keystore Wallet](json-wallets) encrypted with
   *  %%password%%.
   *
   *  If %%progressCallback%% is specified, it will receive periodic
   *  updates as the encryption process progreses.
   */
  async encrypt(password, progressCallback) {
    return await encryptKeystoreJson(this.#account(), password, { progressCallback });
  }
  /**
   *  Returns a [JSON Keystore Wallet](json-wallets) encryped with
   *  %%password%%.
   *
   *  It is preferred to use the [async version](encrypt) instead,
   *  which allows a [[ProgressCallback]] to keep the user informed.
   *
   *  This method will block the event loop (freezing all UI) until
   *  it is complete, which may be a non-trivial duration.
   */
  encryptSync(password) {
    return encryptKeystoreJsonSync(this.#account(), password);
  }
  /**
   *  The extended key.
   *
   *  This key will begin with the prefix ``xpriv`` and can be used to
   *  reconstruct this HD Node to derive its children.
   */
  get extendedKey() {
    assert(this.depth < 256, "Depth too deep", "UNSUPPORTED_OPERATION", { operation: "extendedKey" });
    return encodeBase58Check(concat([
      "0x0488ADE4",
      zpad2(this.depth, 1),
      this.parentFingerprint,
      zpad2(this.index, 4),
      this.chainCode,
      concat(["0x00", this.privateKey])
    ]));
  }
  /**
   *  Returns true if this wallet has a path, providing a Type Guard
   *  that the path is non-null.
   */
  hasPath() {
    return this.path != null;
  }
  /**
   *  Returns a neutered HD Node, which removes the private details
   *  of an HD Node.
   *
   *  A neutered node has no private key, but can be used to derive
   *  child addresses and other public data about the HD Node.
   */
  neuter() {
    return new HDNodeVoidWallet(_guard6, this.address, this.publicKey, this.parentFingerprint, this.chainCode, this.path, this.index, this.depth, this.provider);
  }
  /**
   *  Return the child for %%index%%.
   */
  deriveChild(_index) {
    const index = getNumber(_index, "index");
    assertArgument(index <= 4294967295, "invalid index", "index", index);
    let path2 = this.path;
    if (path2) {
      path2 += "/" + (index & ~HardenedBit);
      if (index & HardenedBit) {
        path2 += "'";
      }
    }
    const { IR, IL } = ser_I(index, this.chainCode, this.publicKey, this.privateKey);
    const ki = new SigningKey(toBeHex((toBigInt(IL) + BigInt(this.privateKey)) % N, 32));
    return new _HDNodeWallet(_guard6, ki, this.fingerprint, hexlify(IR), path2, index, this.depth + 1, this.mnemonic, this.provider);
  }
  /**
   *  Return the HDNode for %%path%% from this node.
   */
  derivePath(path2) {
    return derivePath(this, path2);
  }
  static #fromSeed(_seed, mnemonic) {
    assertArgument(isBytesLike(_seed), "invalid seed", "seed", "[REDACTED]");
    const seed = getBytes(_seed, "seed");
    assertArgument(seed.length >= 16 && seed.length <= 64, "invalid seed", "seed", "[REDACTED]");
    const I = getBytes(computeHmac("sha512", MasterSecret, seed));
    const signingKey = new SigningKey(hexlify(I.slice(0, 32)));
    return new _HDNodeWallet(_guard6, signingKey, "0x00000000", hexlify(I.slice(32)), "m", 0, 0, mnemonic, null);
  }
  /**
   *  Creates a new HD Node from %%extendedKey%%.
   *
   *  If the %%extendedKey%% will either have a prefix or ``xpub`` or
   *  ``xpriv``, returning a neutered HD Node ([[HDNodeVoidWallet]])
   *  or full HD Node ([[HDNodeWallet) respectively.
   */
  static fromExtendedKey(extendedKey) {
    const bytes2 = toBeArray(decodeBase58(extendedKey));
    assertArgument(bytes2.length === 82 || encodeBase58Check(bytes2.slice(0, 78)) === extendedKey, "invalid extended key", "extendedKey", "[ REDACTED ]");
    const depth = bytes2[4];
    const parentFingerprint = hexlify(bytes2.slice(5, 9));
    const index = parseInt(hexlify(bytes2.slice(9, 13)).substring(2), 16);
    const chainCode = hexlify(bytes2.slice(13, 45));
    const key = bytes2.slice(45, 78);
    switch (hexlify(bytes2.slice(0, 4))) {
      case "0x0488b21e":
      case "0x043587cf": {
        const publicKey = hexlify(key);
        return new HDNodeVoidWallet(_guard6, computeAddress(publicKey), publicKey, parentFingerprint, chainCode, null, index, depth, null);
      }
      case "0x0488ade4":
      case "0x04358394 ":
        if (key[0] !== 0) {
          break;
        }
        return new _HDNodeWallet(_guard6, new SigningKey(key.slice(1)), parentFingerprint, chainCode, null, index, depth, null, null);
    }
    assertArgument(false, "invalid extended key prefix", "extendedKey", "[ REDACTED ]");
  }
  /**
   *  Creates a new random HDNode.
   */
  static createRandom(password, path2, wordlist2) {
    if (password == null) {
      password = "";
    }
    if (path2 == null) {
      path2 = defaultPath2;
    }
    if (wordlist2 == null) {
      wordlist2 = LangEn.wordlist();
    }
    const mnemonic = Mnemonic.fromEntropy(randomBytes3(16), password, wordlist2);
    return _HDNodeWallet.#fromSeed(mnemonic.computeSeed(), mnemonic).derivePath(path2);
  }
  /**
   *  Create an HD Node from %%mnemonic%%.
   */
  static fromMnemonic(mnemonic, path2) {
    if (!path2) {
      path2 = defaultPath2;
    }
    return _HDNodeWallet.#fromSeed(mnemonic.computeSeed(), mnemonic).derivePath(path2);
  }
  /**
   *  Creates an HD Node from a mnemonic %%phrase%%.
   */
  static fromPhrase(phrase, password, path2, wordlist2) {
    if (password == null) {
      password = "";
    }
    if (path2 == null) {
      path2 = defaultPath2;
    }
    if (wordlist2 == null) {
      wordlist2 = LangEn.wordlist();
    }
    const mnemonic = Mnemonic.fromPhrase(phrase, password, wordlist2);
    return _HDNodeWallet.#fromSeed(mnemonic.computeSeed(), mnemonic).derivePath(path2);
  }
  /**
   *  Creates an HD Node from a %%seed%%.
   */
  static fromSeed(seed) {
    return _HDNodeWallet.#fromSeed(seed, null);
  }
};
var HDNodeVoidWallet = class _HDNodeVoidWallet extends VoidSigner {
  /**
   *  The compressed public key.
   */
  publicKey;
  /**
   *  The fingerprint.
   *
   *  A fingerprint allows quick qay to detect parent and child nodes,
   *  but developers should be prepared to deal with collisions as it
   *  is only 4 bytes.
   */
  fingerprint;
  /**
   *  The parent node fingerprint.
   */
  parentFingerprint;
  /**
   *  The chaincode, which is effectively a public key used
   *  to derive children.
   */
  chainCode;
  /**
   *  The derivation path of this wallet.
   *
   *  Since extended keys do not provider full path details, this
   *  may be ``null``, if instantiated from a source that does not
   *  enocde it.
   */
  path;
  /**
   *  The child index of this wallet. Values over ``2 *\* 31`` indicate
   *  the node is hardened.
   */
  index;
  /**
   *  The depth of this wallet, which is the number of components
   *  in its path.
   */
  depth;
  /**
   *  @private
   */
  constructor(guard, address, publicKey, parentFingerprint, chainCode, path2, index, depth, provider) {
    super(address, provider);
    assertPrivate(guard, _guard6, "HDNodeVoidWallet");
    defineProperties(this, { publicKey });
    const fingerprint = dataSlice(ripemd1602(sha2562(publicKey)), 0, 4);
    defineProperties(this, {
      publicKey,
      fingerprint,
      parentFingerprint,
      chainCode,
      path: path2,
      index,
      depth
    });
  }
  connect(provider) {
    return new _HDNodeVoidWallet(_guard6, this.address, this.publicKey, this.parentFingerprint, this.chainCode, this.path, this.index, this.depth, provider);
  }
  /**
   *  The extended key.
   *
   *  This key will begin with the prefix ``xpub`` and can be used to
   *  reconstruct this neutered key to derive its children addresses.
   */
  get extendedKey() {
    assert(this.depth < 256, "Depth too deep", "UNSUPPORTED_OPERATION", { operation: "extendedKey" });
    return encodeBase58Check(concat([
      "0x0488B21E",
      zpad2(this.depth, 1),
      this.parentFingerprint,
      zpad2(this.index, 4),
      this.chainCode,
      this.publicKey
    ]));
  }
  /**
   *  Returns true if this wallet has a path, providing a Type Guard
   *  that the path is non-null.
   */
  hasPath() {
    return this.path != null;
  }
  /**
   *  Return the child for %%index%%.
   */
  deriveChild(_index) {
    const index = getNumber(_index, "index");
    assertArgument(index <= 4294967295, "invalid index", "index", index);
    let path2 = this.path;
    if (path2) {
      path2 += "/" + (index & ~HardenedBit);
      if (index & HardenedBit) {
        path2 += "'";
      }
    }
    const { IR, IL } = ser_I(index, this.chainCode, this.publicKey, null);
    const Ki = SigningKey.addPoints(IL, this.publicKey, true);
    const address = computeAddress(Ki);
    return new _HDNodeVoidWallet(_guard6, address, Ki, this.fingerprint, hexlify(IR), path2, index, this.depth + 1, this.provider);
  }
  /**
   *  Return the signer for %%path%% from this node.
   */
  derivePath(path2) {
    return derivePath(this, path2);
  }
};

// node_modules/ethers/lib.esm/wallet/json-crowdsale.js
function isCrowdsaleJson(json) {
  try {
    const data = JSON.parse(json);
    if (data.encseed) {
      return true;
    }
  } catch (error) {
  }
  return false;
}
function decryptCrowdsaleJson(json, _password) {
  const data = JSON.parse(json);
  const password = getPassword(_password);
  const address = getAddress(spelunk(data, "ethaddr:string!"));
  const encseed = looseArrayify(spelunk(data, "encseed:string!"));
  assertArgument(encseed && encseed.length % 16 === 0, "invalid encseed", "json", json);
  const key = getBytes(pbkdf2(password, password, 2e3, 32, "sha256")).slice(0, 16);
  const iv = encseed.slice(0, 16);
  const encryptedSeed = encseed.slice(16);
  const aesCbc = new CBC(key, iv);
  const seed = pkcs7Strip(getBytes(aesCbc.decrypt(encryptedSeed)));
  let seedHex = "";
  for (let i = 0; i < seed.length; i++) {
    seedHex += String.fromCharCode(seed[i]);
  }
  return { address, privateKey: id(seedHex) };
}

// node_modules/ethers/lib.esm/wallet/wallet.js
function stall4(duration) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, duration);
  });
}
var Wallet = class _Wallet extends BaseWallet {
  /**
   *  Create a new wallet for the private %%key%%, optionally connected
   *  to %%provider%%.
   */
  constructor(key, provider) {
    if (typeof key === "string" && !key.startsWith("0x")) {
      key = "0x" + key;
    }
    let signingKey = typeof key === "string" ? new SigningKey(key) : key;
    super(signingKey, provider);
  }
  connect(provider) {
    return new _Wallet(this.signingKey, provider);
  }
  /**
   *  Resolves to a [JSON Keystore Wallet](json-wallets) encrypted with
   *  %%password%%.
   *
   *  If %%progressCallback%% is specified, it will receive periodic
   *  updates as the encryption process progreses.
   */
  async encrypt(password, progressCallback) {
    const account = { address: this.address, privateKey: this.privateKey };
    return await encryptKeystoreJson(account, password, { progressCallback });
  }
  /**
   *  Returns a [JSON Keystore Wallet](json-wallets) encryped with
   *  %%password%%.
   *
   *  It is preferred to use the [async version](encrypt) instead,
   *  which allows a [[ProgressCallback]] to keep the user informed.
   *
   *  This method will block the event loop (freezing all UI) until
   *  it is complete, which may be a non-trivial duration.
   */
  encryptSync(password) {
    const account = { address: this.address, privateKey: this.privateKey };
    return encryptKeystoreJsonSync(account, password);
  }
  static #fromAccount(account) {
    assertArgument(account, "invalid JSON wallet", "json", "[ REDACTED ]");
    if ("mnemonic" in account && account.mnemonic && account.mnemonic.locale === "en") {
      const mnemonic = Mnemonic.fromEntropy(account.mnemonic.entropy);
      const wallet2 = HDNodeWallet.fromMnemonic(mnemonic, account.mnemonic.path);
      if (wallet2.address === account.address && wallet2.privateKey === account.privateKey) {
        return wallet2;
      }
      console.log("WARNING: JSON mismatch address/privateKey != mnemonic; fallback onto private key");
    }
    const wallet = new _Wallet(account.privateKey);
    assertArgument(wallet.address === account.address, "address/privateKey mismatch", "json", "[ REDACTED ]");
    return wallet;
  }
  /**
   *  Creates (asynchronously) a **Wallet** by decrypting the %%json%%
   *  with %%password%%.
   *
   *  If %%progress%% is provided, it is called periodically during
   *  decryption so that any UI can be updated.
   */
  static async fromEncryptedJson(json, password, progress) {
    let account = null;
    if (isKeystoreJson(json)) {
      account = await decryptKeystoreJson(json, password, progress);
    } else if (isCrowdsaleJson(json)) {
      if (progress) {
        progress(0);
        await stall4(0);
      }
      account = decryptCrowdsaleJson(json, password);
      if (progress) {
        progress(1);
        await stall4(0);
      }
    }
    return _Wallet.#fromAccount(account);
  }
  /**
   *  Creates a **Wallet** by decrypting the %%json%% with %%password%%.
   *
   *  The [[fromEncryptedJson]] method is preferred, as this method
   *  will lock up and freeze the UI during decryption, which may take
   *  some time.
   */
  static fromEncryptedJsonSync(json, password) {
    let account = null;
    if (isKeystoreJson(json)) {
      account = decryptKeystoreJsonSync(json, password);
    } else if (isCrowdsaleJson(json)) {
      account = decryptCrowdsaleJson(json, password);
    } else {
      assertArgument(false, "invalid JSON wallet", "json", "[ REDACTED ]");
    }
    return _Wallet.#fromAccount(account);
  }
  /**
   *  Creates a new random [[HDNodeWallet]] using the available
   *  [cryptographic random source](randomBytes).
   *
   *  If there is no crytographic random source, this will throw.
   */
  static createRandom(provider) {
    const wallet = HDNodeWallet.createRandom();
    if (provider) {
      return wallet.connect(provider);
    }
    return wallet;
  }
  /**
   *  Creates a [[HDNodeWallet]] for %%phrase%%.
   */
  static fromPhrase(phrase, provider) {
    const wallet = HDNodeWallet.fromPhrase(phrase);
    if (provider) {
      return wallet.connect(provider);
    }
    return wallet;
  }
};

// src/receipts/receiptStore.ts
var ReceiptStore = class {
  constructor(storage) {
    this.storage = storage;
  }
  async create(draft) {
    const signer = await this.signer();
    const base = { ...draft, receiptVersion: "ixrail-agentpay.receipt.v1", policyDecision: sanitizeDecision(draft.policyDecision) };
    const signedPayload = canonicalJson(base);
    const signature = await signer.signMessage(signedPayload);
    const receipt = {
      ...base,
      signedPayload,
      signature,
      signer: signer.address,
      proofToken: `ixr_${keccak256(toUtf8Bytes(signedPayload)).slice(2, 34)}.${signature.slice(2, 18)}`
    };
    await this.storage.setState(storageKeys.receipts, [receipt, ...this.list()]);
    return receipt;
  }
  list(agentId, limit = 50) {
    const receipts = readMigratedState(this.storage, storageKeys.receipts, legacyStorageKeys.receipts, []);
    return receipts.filter((receipt) => !agentId || receipt.agentId === agentId).slice(0, limit);
  }
  get(receiptId) {
    return this.list(void 0, Number.MAX_SAFE_INTEGER).find((receipt) => receipt.receiptId === receiptId);
  }
  verify(receipt) {
    try {
      const { signedPayload, signature, signer, proofToken: _proof, ...base } = receipt;
      return canonicalJson(base) === signedPayload && verifyMessage(signedPayload, signature).toLowerCase() === signer.toLowerCase();
    } catch {
      return false;
    }
  }
  async signer() {
    let privateKey = await readMigratedSecret(this.storage, storageKeys.receiptSigner, legacyStorageKeys.receiptSigner);
    if (!privateKey) {
      privateKey = Wallet.createRandom().privateKey;
      await this.storage.setSecret(storageKeys.receiptSigner, privateKey);
    }
    return new Wallet(privateKey);
  }
};
function sanitizeDecision(decision) {
  return { approved: decision.approved, requiresHumanApproval: decision.requiresHumanApproval, reason: decision.reason };
}
function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(value) {
  if (Array.isArray(value))
    return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortKeys(item)]));
  }
  return value;
}

// src/wallet/walletService.ts
var import_node_crypto2 = require("node:crypto");
var RPC_URLS = {
  "base-sepolia": process.env.IXRAIL_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
  base: process.env.IXRAIL_BASE_RPC_URL ?? "https://mainnet.base.org"
};
var USDC_ADDRESSES = {
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7c",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
};
var ERC20_ABI = ["function transfer(address to, uint256 value) returns (bool)"];
var WalletService = class {
  constructor(storage) {
    this.storage = storage;
  }
  providers = /* @__PURE__ */ new Map();
  async createWallet(agentId, chain = "base-sepolia") {
    if (!agentId.trim())
      throw new Error("agentId is required");
    if (this.getWalletByAgentId(agentId))
      throw new Error(`Agent ${agentId} already has a wallet`);
    const signer = Wallet.createRandom();
    const record2 = {
      walletId: `wallet_${(0, import_node_crypto2.randomUUID)().replaceAll("-", "").slice(0, 12)}`,
      agentId: agentId.trim(),
      address: signer.address,
      chain,
      sandbox: chain === "base-sepolia",
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await this.storage.setSecret(storageKeys.walletKey(record2.walletId), signer.privateKey);
    await this.storage.setState(storageKeys.wallets, [...this.listWallets(), record2]);
    return record2;
  }
  listWallets() {
    return readMigratedState(this.storage, storageKeys.wallets, legacyStorageKeys.wallets, []);
  }
  getWalletByAgentId(agentId) {
    return this.listWallets().find((wallet) => wallet.agentId === agentId);
  }
  async getBalance(walletId) {
    const wallet = this.requireWallet(walletId);
    const balance = await this.provider(wallet.chain).getBalance(wallet.address);
    return { native: formatEther(balance), nativeSymbol: "ETH", chain: wallet.chain };
  }
  async transferUsdc(walletId, transfer) {
    const wallet = this.requireWallet(walletId);
    if (!isAddress(transfer.recipient))
      throw new Error("Invalid USDC recipient address");
    if (!Number.isFinite(transfer.amountUsd) || transfer.amountUsd <= 0)
      throw new Error("USDC amount must be positive");
    if (wallet.chain === "base" && !realSettlementEnabled()) {
      throw new Error("Mainnet settlement is disabled; set IXRAIL_ALLOW_MAINNET_PAYMENTS=1 to enable it");
    }
    const privateKey = await readMigratedSecret(
      this.storage,
      storageKeys.walletKey(walletId),
      legacyStorageKeys.walletKey(walletId)
    );
    if (!privateKey)
      throw new Error("Wallet private key is unavailable");
    const signer = new Wallet(privateKey, this.provider(wallet.chain));
    const token = new Contract(USDC_ADDRESSES[wallet.chain], ERC20_ABI, signer);
    const transaction = await token.getFunction("transfer")(
      getAddress(transfer.recipient),
      parseUnits(transfer.amountUsd.toFixed(6), 6)
    );
    return transaction.hash;
  }
  requireWallet(walletId) {
    const wallet = this.listWallets().find((candidate) => candidate.walletId === walletId);
    if (!wallet)
      throw new Error(`Unknown wallet: ${walletId}`);
    return wallet;
  }
  provider(chain) {
    let provider = this.providers.get(chain);
    if (!provider) {
      provider = new JsonRpcProvider(RPC_URLS[chain], void 0, { staticNetwork: true });
      this.providers.set(chain, provider);
    }
    return provider;
  }
};
function realSettlementEnabled() {
  return process.env.IXRAIL_ALLOW_MAINNET_PAYMENTS === "1";
}

// src/x402/x402Client.ts
var import_node_crypto3 = require("node:crypto");
var X402Client = class {
  constructor(policy, wallets, receipts, requestApproval, simulateSettlement = () => true) {
    this.policy = policy;
    this.wallets = wallets;
    this.receipts = receipts;
    this.requestApproval = requestApproval;
    this.simulateSettlement = simulateSettlement;
  }
  async payAndFetch(url, agentId, options2 = {}) {
    const target = validateUrl(url);
    const { maxAmountUsd, timeoutMs = 2e4, ...request } = options2;
    if (maxAmountUsd !== void 0 && (!Number.isFinite(maxAmountUsd) || maxAmountUsd <= 0))
      throw new Error("maxAmountUsd must be positive");
    const initial = await fetchTimed(target, request, timeoutMs);
    if (initial.status !== 402)
      return { status: initial.status, data: await safeBody(initial) };
    const requirements = await parseRequirements(initial, target.href);
    if (maxAmountUsd !== void 0 && requirements.amountUsd > maxAmountUsd)
      return { status: 402, data: null, denied: "Payment exceeds request maximum" };
    const wallet = this.wallets.getWalletByAgentId(agentId);
    if (!wallet)
      throw new Error(`No wallet found for agent ${agentId}`);
    if (wallet.chain !== requirements.chain)
      throw new Error(`Wallet chain ${wallet.chain} does not match ${requirements.chain}`);
    const intent = makeIntent(agentId, requirements, target);
    const decision = await this.policy.evaluate(intent);
    if (!decision.approved && !decision.requiresHumanApproval)
      return { status: 402, data: null, denied: decision.reason };
    if (decision.requiresHumanApproval && !await this.requestApproval(intent))
      return { status: 402, data: null, denied: "Denied by developer" };
    const reservation = await this.policy.reserveSpend(intent, decision.requiresHumanApproval);
    if (!reservation.approved)
      return { status: 402, data: null, denied: reservation.reason };
    const simulated = wallet.sandbox && this.simulateSettlement();
    let txHash;
    try {
      txHash = simulated ? `0x${(0, import_node_crypto3.randomBytes)(32).toString("hex")}` : await this.wallets.transferUsdc(wallet.walletId, { recipient: requirements.recipient, amountUsd: requirements.amountUsd });
    } catch (error) {
      if (reservation.reservationId)
        await this.policy.releaseReservation(reservation.reservationId);
      throw error;
    }
    await this.policy.recordSpend(agentId, requirements.amountUsd, reservation.reservationId);
    const receipt = await this.receipts.create({
      receiptId: `rcpt_${shortId()}`,
      intentId: intent.intentId,
      agentId,
      amountUsd: requirements.amountUsd,
      currency: "USDC",
      recipient: requirements.recipient,
      merchantDomain: target.hostname,
      resource: requirements.resource,
      txHash,
      chain: wallet.chain,
      confirmedAt: (/* @__PURE__ */ new Date()).toISOString(),
      policyDecision: { approved: true, requiresHumanApproval: decision.requiresHumanApproval, reason: decision.requiresHumanApproval ? "Approved by developer" : "Within policy" },
      settlement: simulated ? "simulated" : "usdc"
    });
    const headers = new Headers(request.headers);
    headers.set("X-Payment-Proof", receipt.proofToken);
    headers.set("X-Ixrail-Receipt", Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url"));
    const retry = await fetchTimed(target, { ...request, headers }, timeoutMs);
    return { status: retry.status, data: await safeBody(retry), receiptId: receipt.receiptId };
  }
};
async function parseRequirements(response, fallbackResource) {
  const body = await safeBody(response);
  const root = expectRecord(body);
  const nested = root.paymentRequirements;
  const selected = Array.isArray(nested) ? nested[0] : nested ?? root;
  const record2 = expectRecord(selected);
  const amountUsd = Number(record2.amount);
  const currency = record2.asset ?? record2.currency;
  const recipient = record2.recipient;
  const chain = record2.chain;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0)
    throw new Error("Invalid x402 amount");
  if (currency !== "USDC")
    throw new Error("Only USDC x402 requirements are supported");
  if (chain !== "base" && chain !== "base-sepolia")
    throw new Error("Unsupported x402 chain");
  if (typeof recipient !== "string" || !isAddress(recipient))
    throw new Error("Invalid x402 recipient");
  return { amountUsd, currency: "USDC", recipient: getAddress(recipient), chain, resource: typeof record2.resource === "string" ? record2.resource : fallbackResource };
}
function makeIntent(agentId, requirement, url) {
  return { intentId: `pi_${shortId()}`, agentId, amountUsd: requirement.amountUsd, currency: "USDC", recipient: requirement.recipient, merchantDomain: url.hostname, memo: `x402:${url.href}`, createdAt: (/* @__PURE__ */ new Date()).toISOString(), expiresAt: new Date(Date.now() + 3e5).toISOString(), status: "pending_policy" };
}
function validateUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("x402 URL must use HTTP or HTTPS");
  return url;
}
async function fetchTimed(url, init2, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init2, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
async function safeBody(response) {
  const text = await response.text();
  if (!text)
    return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function expectRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid x402 response body");
  return value;
}
var shortId = () => (0, import_node_crypto3.randomUUID)().replaceAll("-", "").slice(0, 12);

// src/runtime/services.ts
function createServices(storage, approval = async () => false, simulate = () => true) {
  const wallets = new WalletService(storage);
  const policy = new PolicyEngine(storage);
  const receipts = new ReceiptStore(storage);
  return { wallets, policy, receipts, x402: new X402Client(policy, wallets, receipts, approval, simulate) };
}

// src/mcp/server.ts
var services = createServices(new FileStorage());
var tools = [
  { name: "get_balance", description: "Get an agent wallet's native gas balance", inputSchema: schema({ agentId: stringField() }, ["agentId"]) },
  { name: "request_payment", description: "Evaluate a proposed USDC payment without settling it", inputSchema: schema({ agentId: stringField(), amountUsd: numberField(), recipient: stringField(), merchantDomain: stringField() }, ["agentId", "amountUsd", "recipient", "merchantDomain"]) },
  { name: "pay_x402_endpoint", description: "Execute an approved x402 USDC flow", inputSchema: schema({ agentId: stringField(), url: stringField(), maxAmountUsd: numberField() }, ["agentId", "url"]) },
  { name: "create_spending_policy", description: "Create or replace an agent spending policy", inputSchema: schema({ agentId: stringField(), perTxCapUsd: numberField(), dailyCapUsd: numberField(), monthlyCapUsd: numberField(), approvalThresholdUsd: numberField(), allowlist: stringArrayField(), blocklist: stringArrayField() }, ["agentId", "perTxCapUsd", "dailyCapUsd", "monthlyCapUsd", "approvalThresholdUsd"]) },
  { name: "get_receipt", description: "Fetch and verify a signed payment receipt", inputSchema: schema({ receiptId: stringField() }, ["receiptId"]) },
  { name: "revoke_agent_access", description: "Revoke an agent's spending access", inputSchema: schema({ agentId: stringField() }, ["agentId"]) }
];
async function callTool(name, argumentsValue) {
  try {
    const args = record(argumentsValue ?? {});
    switch (name) {
      case "get_balance": {
        const agentId = stringValue(args, "agentId");
        const wallet = services.wallets.getWalletByAgentId(agentId);
        if (!wallet)
          return result({ error: `No wallet for ${agentId}` }, true);
        return result({ address: wallet.address, ...await services.wallets.getBalance(wallet.walletId) });
      }
      case "request_payment":
        return result(await services.policy.evaluate(manualIntent(args)));
      case "pay_x402_endpoint":
        return result(await services.x402.payAndFetch(stringValue(args, "url"), stringValue(args, "agentId"), options(args)));
      case "create_spending_policy":
        return result(await services.policy.setPolicy({
          agentId: stringValue(args, "agentId"),
          perTxCapUsd: numberValue(args, "perTxCapUsd"),
          dailyCapUsd: numberValue(args, "dailyCapUsd"),
          monthlyCapUsd: numberValue(args, "monthlyCapUsd"),
          approvalThresholdUsd: nonNegativeValue(args, "approvalThresholdUsd"),
          allowlist: stringArrayValue(args, "allowlist"),
          blocklist: stringArrayValue(args, "blocklist")
        }));
      case "get_receipt": {
        const receipt = services.receipts.get(stringValue(args, "receiptId"));
        return receipt ? result({ ...receipt, verified: services.receipts.verify(receipt) }) : result({ error: "Receipt not found" }, true);
      }
      case "revoke_agent_access": {
        const agentId = stringValue(args, "agentId");
        await services.policy.revokeAgent(agentId);
        return result({ agentId, revoked: true });
      }
      default:
        return result({ error: `Unknown tool: ${name}` }, true);
    }
  } catch (error) {
    return result({ error: error instanceof Error ? error.message : String(error) }, true);
  }
}
async function handle(request) {
  switch (request.method) {
    case "initialize": {
      const params = request.params && typeof request.params === "object" ? request.params : {};
      return {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ixrail-agentpay-mcp", version: "0.2.6" }
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools };
    case "tools/call": {
      const params = record(request.params ?? {});
      return callTool(stringValue(params, "name"), params.arguments);
    }
    default:
      throw new RpcError(-32601, `Method not found: ${request.method}`);
  }
}
var RpcError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function send(response) {
  process.stdout.write(`${JSON.stringify(response)}
`);
}
var buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim())
      continue;
    void processLine(line);
  }
});
process.stdin.on("end", () => process.exit(0));
async function processLine(line) {
  let request;
  try {
    request = JSON.parse(line);
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string")
      throw new RpcError(-32600, "Invalid Request");
  } catch (error) {
    const rpc = error instanceof RpcError ? error : new RpcError(-32700, "Parse error");
    send({ jsonrpc: "2.0", id: null, error: { code: rpc.code, message: rpc.message } });
    return;
  }
  if (request.id === void 0)
    return;
  try {
    send({ jsonrpc: "2.0", id: request.id, result: await handle(request) });
  } catch (error) {
    const rpc = error instanceof RpcError ? error : new RpcError(-32603, error instanceof Error ? error.message : String(error));
    send({ jsonrpc: "2.0", id: request.id, error: { code: rpc.code, message: rpc.message } });
  }
}
function manualIntent(args) {
  return { intentId: `pi_${Date.now()}`, agentId: stringValue(args, "agentId"), amountUsd: numberValue(args, "amountUsd"), currency: "USDC", recipient: stringValue(args, "recipient"), merchantDomain: stringValue(args, "merchantDomain"), createdAt: (/* @__PURE__ */ new Date()).toISOString(), expiresAt: new Date(Date.now() + 3e5).toISOString(), status: "pending_policy" };
}
function options(args) {
  return typeof args.maxAmountUsd === "number" ? { maxAmountUsd: numberValue(args, "maxAmountUsd") } : {};
}
function result(payload, isError2 = false) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], isError: isError2 };
}
function record(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Arguments must be an object");
  return value;
}
function stringValue(body, key) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}
function numberValue(body, key) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`${key} must be positive`);
  return value;
}
function nonNegativeValue(body, key) {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`${key} must be non-negative`);
  return value;
}
function stringArrayValue(body, key) {
  const value = body[key];
  if (value === void 0)
    return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new Error(`${key} must be a string array`);
  return value.map((entry) => entry.trim()).filter(Boolean);
}
function stringField() {
  return { type: "string" };
}
function numberField() {
  return { type: "number" };
}
function stringArrayField() {
  return { type: "array", items: stringField() };
}
function schema(properties, required) {
  return { type: "object", properties, required };
}
/*! Bundled license information:

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/utils.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/modular.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/curve.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/abstract/weierstrass.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/_shortw_utils.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/esm/secp256k1.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

aes-js/lib.esm/aes.js:
  (*! MIT License. Copyright 2015-2022 Richard Moore <me@ricmoo.com>. See LICENSE.txt. *)
*/
//# sourceMappingURL=server.js.map
