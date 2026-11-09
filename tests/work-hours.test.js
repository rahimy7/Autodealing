import test from "node:test";
import assert from "node:assert/strict";
import { workHours, workSlot, DEALER_TZ } from "../server/work-hours.js";

// November 2026 is Eastern Standard Time (UTC-5); July is daylight time (UTC-4).
const at = (window, iso) => workSlot(window, new Date(iso));

test("background checks run Monday to Friday, 9:00 to 17:00 dealer time, once an hour", () => {
  const w = workHours({});
  assert.equal(w.timeZone, DEALER_TZ);
  const monday = [8, 9, 10, 13, 16, 17, 18].map((h) => at(w, `2026-11-09T${String(h + 5).padStart(2, "0")}:00:20Z`));
  assert.deepEqual(monday, [null, "2026-11-09 09:00", "2026-11-09 10:00", "2026-11-09 13:00", "2026-11-09 16:00", "2026-11-09 17:00", null]);
  assert.equal(at(w, "2026-11-09T14:30:00Z"), null, "only on the hour");
  assert.equal(at(w, "2026-11-13T22:00:00Z"), "2026-11-13 17:00", "Friday's last check");
  assert.equal(at(w, "2026-11-14T15:00:00Z"), null, "Saturday");
  assert.equal(at(w, "2026-11-15T15:00:00Z"), null, "Sunday");
  assert.equal(at(w, "2026-07-15T13:00:00Z"), "2026-07-15 09:00", "daylight time keeps 9:00 local");
  // 9:00 in New York is still Monday while it is already 14:00 in UTC; 20:00 Friday NY is Saturday UTC.
  assert.equal(at(w, "2026-11-14T01:00:00Z"), null);
});

test("the hours can be changed, and a wrong value falls back to the defaults", () => {
  const w = workHours({ SCHEDULER_DAYS: "1,3,6", SCHEDULER_HOURS: "08:30-12:30", SCHEDULER_INTERVAL_MINUTES: "120" });
  assert.equal(at(w, "2026-11-14T13:30:00Z"), "2026-11-14 08:30", "Saturday is on the list");
  assert.equal(at(w, "2026-11-14T15:30:00Z"), "2026-11-14 10:30");
  assert.equal(at(w, "2026-11-14T14:30:00Z"), null, "every two hours from 8:30");
  assert.equal(at(w, "2026-11-10T13:30:00Z"), null, "Tuesday is not");
  for (const bad of [{ SCHEDULER_HOURS: "9-5" }, { SCHEDULER_DAYS: "lunes" }, { SCHEDULER_INTERVAL_MINUTES: "0" }, { SCHEDULER_HOURS: "17:00-09:00" }])
    assert.deepEqual(workHours(bad).env, { days: "1-5", hours: "09:00-17:00", everyMinutes: "60" }, JSON.stringify(bad));
});
