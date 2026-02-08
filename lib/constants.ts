export const ADMIN_EMAIL = "admin@example.com";

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Weekday = typeof WEEKDAYS[number];
