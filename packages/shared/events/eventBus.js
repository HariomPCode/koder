const crypto = require("crypto");
const Redis = require("ioredis");
const { getRedisConfig } = require("../config/queues");

const CHANNEL = "koder:domain-events";
const STREAM = "koder:domain-events:stream";

class ExternalEventBus {
  constructor() {
    this.listeners = new Map();
    this.anyListeners = new Set();
    this.instanceId = crypto.randomUUID();
    this.publisher = null;
    this.subscriber = null;
    this.subscriptionStarted = false;
  }

  ensureRedis() {
    if (!this.publisher) {
      this.publisher = new Redis(getRedisConfig());
      this.publisher.on("error", () => {});
    }
    if (!this.subscriber) {
      this.subscriber = new Redis(getRedisConfig());
      this.subscriber.on("error", () => {});
      this.subscriber.on("message", (_channel, message) => {
        try {
          const event = JSON.parse(message);
          if (event.origin === this.instanceId) return;
          this.dispatch(event.name, event.payload, event);
        } catch (_) {
          // Malformed broker messages are ignored without affecting subscribers.
        }
      });
    }
    if (!this.subscriptionStarted) {
      this.subscriptionStarted = true;
      this.subscriber.subscribe(CHANNEL).catch(() => {});
    }
  }

  on(eventName, listener) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(listener);
    this.ensureRedis();
    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;
    listeners.delete(listener);
    if (listeners.size === 0) this.listeners.delete(eventName);
  }

  onAny(listener) {
    this.anyListeners.add(listener);
    this.ensureRedis();
    return () => this.anyListeners.delete(listener);
  }

  dispatch(eventName, payload, event = null) {
    for (const listener of this.listeners.get(eventName) || []) listener(payload, eventName, event);
    for (const listener of this.anyListeners) listener(payload, eventName, event);
  }

  emit(eventName, payload) {
    const event = {
      eventId: crypto.randomUUID(),
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      origin: this.instanceId,
      name: eventName,
      payload,
    };
    this.dispatch(eventName, payload, event);
    this.ensureRedis();
    const serialized = JSON.stringify(event);
    Promise.all([
      this.publisher.publish(CHANNEL, serialized),
      this.publisher.xadd(STREAM, "MAXLEN", "10000", "*", "event", serialized),
    ]).catch(() => {});
    return payload;
  }

  async close() {
    await Promise.all([
      this.publisher?.quit().catch(() => {}),
      this.subscriber?.quit().catch(() => {}),
    ]);
    this.publisher = null;
    this.subscriber = null;
    this.subscriptionStarted = false;
  }
}

module.exports = new ExternalEventBus();
module.exports.CHANNEL = CHANNEL;
module.exports.STREAM = STREAM;
module.exports.ExternalEventBus = ExternalEventBus;
