import type { SmartReminderPriority } from "@/lib/crm/types";

const priorities: SmartReminderPriority[] = ["info", "low", "medium", "high", "urgent", "critical"];

export function smartReminderPriorityWeight(priority: SmartReminderPriority): number {
  return priorities.indexOf(priority) + 1;
}

export function nextSmartReminderPriority(priority: SmartReminderPriority): SmartReminderPriority {
  return priorities[Math.min(priorities.length - 1, priorities.indexOf(priority) + 1)];
}

export function higherSmartReminderPriority(left: SmartReminderPriority, right: SmartReminderPriority): SmartReminderPriority {
  return smartReminderPriorityWeight(left) >= smartReminderPriorityWeight(right) ? left : right;
}

export function localCalendarDayKey(value: Date): string {
  return [value.getFullYear(), String(value.getMonth() + 1).padStart(2, "0"), String(value.getDate()).padStart(2, "0")].join("-");
}

export function smartReminderCooldownDays(priority: SmartReminderPriority): number {
  const weight = smartReminderPriorityWeight(priority);
  if (weight >= smartReminderPriorityWeight("urgent")) return 1;
  if (weight >= smartReminderPriorityWeight("medium")) return 2;
  return 3;
}

export function smartReminderNextEligibleAt(priority: SmartReminderPriority, completedAt: Date): Date {
  const next = new Date(completedAt);
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + smartReminderCooldownDays(priority) + 1);
  return next;
}
