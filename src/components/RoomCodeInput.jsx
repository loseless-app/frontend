import React, { useRef, useState } from "react";

/**
 * Single input container matching the Username field, with editable slots
 * and compact bottom dashes:
 * [ A  B  C  D  —  1  2  3  4 ]
 * Click any slot to edit/replace in case of typos.
 */
export function RoomCodeInput({
  value = "",
  onChange,
  hasError = false,
  disabled = false,
}) {
  const inputsRef = useRef([]);
  const [activeIndex, setActiveIndex] = useState(null);

  const PLACEHOLDER_CHARS = ["A", "B", "C", "D", "1", "2", "3", "4"];

  // Parse raw 8 characters (up to 4 letters, then up to 4 digits)
  const sanitize = (val) => {
    const raw = (val || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    let letters = "";
    let digits = "";

    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (letters.length < 4 && /[A-Z]/.test(c)) {
        letters += c;
      } else if (letters.length >= 4 && digits.length < 4 && /[0-9]/.test(c)) {
        digits += c;
      }
    }

    return { letters, digits, combined: letters + digits };
  };

  const { combined } = sanitize(value);
  const chars = Array.from({ length: 8 }, (_, i) => combined[i] || "");

  const emitChange = (newChars) => {
    const letters = newChars.slice(0, 4).join("").toUpperCase();
    const digits = newChars.slice(4).join("");
    if (digits.length > 0) {
      onChange(`${letters}-${digits}`);
    } else if (letters.length > 0) {
      onChange(letters);
    } else {
      onChange("");
    }
  };

  const handleSlotChange = (e, index) => {
    const val = e.target.value;
    if (!val) {
      const nextChars = [...chars];
      nextChars[index] = "";
      emitChange(nextChars);
      return;
    }

    // Always take the latest typed character (allows in-place replacement)
    const char = val.slice(-1).toUpperCase();

    // Box 0-3: Letters only (A-Z)
    // Box 4-7: Digits only (0-9)
    if (index < 4) {
      if (!/[A-Z]/.test(char)) {
        e.target.value = chars[index] ? chars[index].toUpperCase() : "";
        return;
      }
    } else {
      if (!/[0-9]/.test(char)) {
        e.target.value = chars[index] ? chars[index].toUpperCase() : "";
        return;
      }
    }

    const nextChars = [...chars];
    nextChars[index] = char;
    emitChange(nextChars);

    // Auto-advance to the next slot after replacing/typing
    if (index < 7 && inputsRef.current[index + 1]) {
      inputsRef.current[index + 1].focus();
      inputsRef.current[index + 1].select();
    }
  };

  const handleSlotKeyDown = (e, index) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const nextChars = [...chars];

      if (chars[index]) {
        // Clear current slot
        nextChars[index] = "";
        emitChange(nextChars);
        if (index > 0 && inputsRef.current[index - 1]) {
          inputsRef.current[index - 1].focus();
          inputsRef.current[index - 1].select();
        }
      } else if (index > 0 && inputsRef.current[index - 1]) {
        // Current already empty: clear previous and focus it
        nextChars[index - 1] = "";
        emitChange(nextChars);
        inputsRef.current[index - 1].focus();
        inputsRef.current[index - 1].select();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      inputsRef.current[index - 1]?.focus();
      inputsRef.current[index - 1]?.select();
    } else if (e.key === "ArrowRight" && index < 7) {
      e.preventDefault();
      inputsRef.current[index + 1]?.focus();
      inputsRef.current[index + 1]?.select();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");

    if (!pasted) return;

    const nextChars = [...chars];
    let lastFilled = -1;

    for (let i = 0; i < 8 && i < pasted.length; i++) {
      const c = pasted[i];
      if (i < 4 && /[A-Z]/.test(c)) {
        nextChars[i] = c;
        lastFilled = i;
      } else if (i >= 4 && /[0-9]/.test(c)) {
        nextChars[i] = c;
        lastFilled = i;
      }
    }

    emitChange(nextChars);

    const nextFocus = Math.min(lastFilled + 1, 7);
    if (inputsRef.current[nextFocus]) {
      inputsRef.current[nextFocus].focus();
      inputsRef.current[nextFocus].select();
    }
  };

  const handleContainerClick = (e) => {
    if (e.target.tagName !== "INPUT") {
      const firstEmpty = chars.findIndex((c) => !c);
      const targetIdx = firstEmpty !== -1 ? firstEmpty : 7;
      inputsRef.current[targetIdx]?.focus();
      inputsRef.current[targetIdx]?.select();
    }
  };

  const renderSlot = (index) => {
    const char = chars[index];
    const isCurrent = activeIndex === index;

    return (
      <div
        key={index}
        className="flex flex-col items-center justify-center w-5 sm:w-6"
      >
        {/* Character input slot */}
        <input
          ref={(el) => (inputsRef.current[index] = el)}
          type="text"
          inputMode={index < 4 ? "text" : "numeric"}
          maxLength={2}
          value={char ? char.toUpperCase() : ""}
          placeholder={PLACEHOLDER_CHARS[index]}
          onChange={(e) => handleSlotChange(e, index)}
          onKeyDown={(e) => handleSlotKeyDown(e, index)}
          onFocus={(e) => {
            setActiveIndex(index);
            e.target.select();
          }}
          onBlur={() => setActiveIndex(null)}
          onPaste={handlePaste}
          disabled={disabled}
          autoComplete="off"
          aria-label={`Room code character ${index + 1}`}
          className="w-full h-6 bg-transparent border-0 outline-none text-center font-mono font-bold text-base sm:text-lg text-ink uppercase placeholder:text-ink-muted/30 caret-transparent cursor-text p-0 m-0 leading-none select-all"
        />
        {/* Compact bottom dash underline */}
        <span
          className={`w-3.5 sm:w-4.5 h-[2px] rounded-full transition-colors mt-0.5 ${
            hasError
              ? "bg-red-500/70"
              : isCurrent
              ? "bg-accent"
              : char
              ? "bg-ink/70"
              : "bg-ink/20"
          }`}
        />
      </div>
    );
  };

  return (
    <div
      onClick={handleContainerClick}
      className={`w-full bg-ink/5 border px-4 py-2.5 flex items-center justify-center relative cursor-text transition-shadow ${
        hasError
          ? "border-red-500/50 ring-2 ring-red-500/20"
          : activeIndex !== null
          ? "border-accent ring-2 ring-accent"
          : "border-ink/10 hover:border-ink/20"
      }`}
    >
      <div className="flex items-center justify-center gap-1 sm:gap-1.5 select-none">
        {/* 4 Letters */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {[0, 1, 2, 3].map(renderSlot)}
        </div>

        {/* Center default dash */}
        <span className="text-ink-muted/40 font-mono font-bold text-base mx-1 sm:mx-1.5 select-none pb-1">
          —
        </span>

        {/* 4 Digits */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {[4, 5, 6, 7].map(renderSlot)}
        </div>
      </div>
    </div>
  );
}
