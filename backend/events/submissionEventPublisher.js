const eventBus = require("./eventBus");

class SubmissionEventPublisher {
  emit(eventName, payload) {
    return eventBus.emit(eventName, payload);
  }
}

module.exports = new SubmissionEventPublisher();
