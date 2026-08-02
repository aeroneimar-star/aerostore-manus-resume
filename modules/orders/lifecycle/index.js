"use strict";

const { OrderLifecycleMachine, STATES, EVENTS } = require("./OrderLifecycleMachine");
const { EventBus, getEventBus, resetEventBus } = require("./EventBus");
const { OrderLifecycleEngine, createOrderLifecycleEngine } = require("./OrderLifecycleEngine");
const { TimelineService, createTimelineService } = require("./TimelineService");
const { TrackingProvider, MockTrackingProvider } = require("./TrackingProvider");
const { ReturnService, createReturnService, RETURN_STATUSES, RETURN_REASONS } = require("./ReturnService");
const {
  createNotificationEventEmitter,
  NOTIFICATION_TYPES,
  EVENT_TO_NOTIFICATION,
  NOTIFICATION_TEMPLATES,
} = require("./NotificationEvents");
const {
  createOrderLifecycleService,
  LifecycleError,
} = require("./OrderLifecycleService");
const {
  formatStatusForDisplay,
  formatStatusColor,
  formatCentsBrl,
  orderDto,
  timelineEntryDto,
  envelope,
} = require("./orderLifecycleDto");

module.exports = {
  // Machine
  OrderLifecycleMachine,
  STATES,
  EVENTS,

  // Engine
  OrderLifecycleEngine,
  createOrderLifecycleEngine,

  // Service (facade)
  createOrderLifecycleService,
  LifecycleError,

  // EventBus
  EventBus,
  getEventBus,
  resetEventBus,

  // Timeline
  TimelineService,
  createTimelineService,

  // Tracking
  TrackingProvider,
  MockTrackingProvider,

  // Returns
  ReturnService,
  createReturnService,
  RETURN_STATUSES,
  RETURN_REASONS,

  // Notifications
  createNotificationEventEmitter,
  NOTIFICATION_TYPES,
  EVENT_TO_NOTIFICATION,
  NOTIFICATION_TEMPLATES,

  // DTO
  formatStatusForDisplay,
  formatStatusColor,
  formatCentsBrl,
  orderDto,
  timelineEntryDto,
  envelope,
};
