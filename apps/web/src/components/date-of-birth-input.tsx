"use client";

import { useMemo } from "react";
import {
  MONTH_NAMES,
  daysInMonth,
  fromIsoDate,
  toIsoDate,
} from "@/lib/dates";

/**
 * Birthday entry as three dropdowns: day, month, year.
 *
 * WHY NOT `<input type="date">`
 *
 * It renders in the browser's locale, so the same field reads dd-mm-yyyy for
 * one customer and mm-dd-yyyy for another, with nothing we can set to change
 * it. For a birthday that is not cosmetic: 05-12 is either 5 December or 12
 * May, the customer cannot tell which was recorded, and the café sends the
 * birthday treat in the wrong month with no way to notice.
 *
 * Three dropdowns state the order instead of implying it. They also suit the
 * people actually using this: no keyboard on a phone at a counter, nothing to
 * mistype, and a month spelled out in words rather than as a number. The café
 * owner who tested this asked specifically for a flow someone not comfortable
 * with apps could complete.
 *
 * Emits the ISO `YYYY-MM-DD` the API expects, or "" while incomplete — so a
 * half-filled control is indistinguishable from an empty one and `required`
 * works the way a caller expects.
 */

const CURRENT_YEAR = new Date().getFullYear();
// 1910 at the far end. A loyalty card for someone older than that is less
// likely than a mis-scroll, and a shorter list is easier to get through.
const FIRST_YEAR = 1910;

export interface DateOfBirthInputProps {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  required?: boolean;
  /** Prefix for the generated field ids, so two can coexist on one page. */
  idPrefix?: string;
}

const SELECT_CLASS =
  "block w-full rounded-lg border border-brand-green/15 bg-brand-cream/30 px-2 py-2.5 text-sm text-brand-green focus:outline-none focus:border-brand-green/40";

export function DateOfBirthInput({
  value,
  onChange,
  disabled = false,
  required = false,
  idPrefix = "dob",
}: DateOfBirthInputProps): JSX.Element {
  const { day, month, year } = fromIsoDate(value);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = CURRENT_YEAR; y >= FIRST_YEAR; y -= 1) out.push(y);
    return out;
  }, []);

  const maxDay = daysInMonth(month, year);
  const days = useMemo(
    () => Array.from({ length: maxDay }, (_, i) => i + 1),
    [maxDay]
  );

  function emit(next: { day?: string; month?: string; year?: string }): void {
    const d = next.day ?? day;
    const m = next.month ?? month;
    const y = next.year ?? year;

    // Changing month or year can strip a day that no longer exists — 31
    // January to February, or 29 February to a non-leap year. Clamping beats
    // silently keeping an impossible date, and beats clearing the whole field.
    const limit = daysInMonth(m, y);
    const clamped = d && Number(d) > limit ? String(limit) : d;

    onChange(toIsoDate(clamped, m, y));
  }

  return (
    <div className="mt-1 grid grid-cols-[1fr_1.4fr_1fr] gap-2">
      <select
        aria-label="Day of birth"
        id={`${idPrefix}-day`}
        className={SELECT_CLASS}
        value={day}
        disabled={disabled}
        required={required}
        onChange={(e) => emit({ day: e.target.value })}
      >
        <option value="">Day</option>
        {days.map((d) => (
          <option key={d} value={String(d).padStart(2, "0")}>
            {d}
          </option>
        ))}
      </select>

      <select
        aria-label="Month of birth"
        id={`${idPrefix}-month`}
        className={SELECT_CLASS}
        value={month}
        disabled={disabled}
        required={required}
        onChange={(e) => emit({ month: e.target.value })}
      >
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={String(i + 1).padStart(2, "0")}>
            {name}
          </option>
        ))}
      </select>

      <select
        aria-label="Year of birth"
        id={`${idPrefix}-year`}
        className={SELECT_CLASS}
        value={year}
        disabled={disabled}
        required={required}
        onChange={(e) => emit({ year: e.target.value })}
      >
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
}
