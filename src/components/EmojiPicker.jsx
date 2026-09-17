import React, { useState, useRef } from "react";

const CATEGORIES = [
  {
    id: "smileys",
    icon: "😀",
    name: "Smileys & Emotions",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥹", "😊",
      "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗", "😙",
      "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎",
      "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁",
      "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😮‍💨", "😤",
      "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰",
      "😥", "😓", "🤗", "🤔", "🫣", "🤭", "🫢", "🫡", "🤫", "🫠",
      "🤥", "😶", "😐", "😑", "😬", "🙄", "😯", "😦", "😧", "😮",
      "😲", "🥱", "😴", "🤤", "😪", "😵", "😵‍💫", "🤐", "🥴", "🤢",
      "🤮", "🤧", "😷", "🤒", "🤕", "🤑", "🤠", "😈", "👿", "👺",
      "🤡", "💩", "👻", "💀", "☠️", "👽", "👾", "🤖",
    ],
  },
  {
    id: "gestures",
    icon: "👋",
    name: "Gestures & People",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "🫱", "🫲", "🫳", "🫴", "👌",
      "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉",
      "👆", "🖕", "👇", "☝️", "👍", "👎", "✊", "👊", "🤛", "🤜",
      "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏", "✍️", "💅", "🤳",
      "💪", "🦾", "🦿", "🦵", "🦶", "👂", "🦻", "👃", "🧠", "🫀",
      "🫁", "🦷", "🦴", "👀", "👁️", "👅", "👄", "🫦",
    ],
  },
  {
    id: "symbols",
    icon: "❤️",
    name: "Hearts & Symbols",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "❤️‍🩹", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
      "💟", "💯", "💢", "💥", "💫", "💬", "💭", "🗯️", "💤", "⚡",
      "✨", "⭐", "🌟", "🔥", "💥", "☀️", "🌈", "❌", "⭕", "🛑",
      "⛔", "📛", "🚫", "❗️", "❕", "❓", "❔", "‼️", "⁉️", "⚠️",
      "✅", "❇️", "✳️", "❎", "🌐", "💠", "🆗", "🆙", "🆒", "🆕",
      "FREE", "0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣",
      "9️⃣", "🔟",
    ],
  },
  {
    id: "food",
    icon: "🍕",
    name: "Food & Drink",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐",
      "🍈", "🍒", "🍑", "🥭", "🍍", "🥥", "🥝", "🍅", "🥑", "🥦",
      "🌶️", "🌽", "🥕", "🥔", "🥐", "🍞", "🥖", "🥨", "🧀", "🍳",
      "🥞", "🧇", "🥓", "🥩", "🍗", "🍖", "🌭", "🍔", "🍟", "🍕",
      "🥪", "🥙", "🌮", "🌯", "🥗", "🥘", "🍝", "🍜", "🍲", "🍛",
      "🍣", "🍱", "🥟", "🍤", "🍙", "🍚", "🍘", "🍦", "🍧", "🍨",
      "🍩", "🍪", "🎂", "🍰", "🧁", "🥧", "🍫", "🍬", "🍭", "🍮",
      "🍯", "🍼", "🥛", "☕", "🫖", "🍵", "🍶", "🍾", "🍷", "🍸",
      "🍹", "🍺", "🍻", "🥂", "🥃", "🥤", "🧋", "🍿",
    ],
  },
  {
    id: "activities",
    icon: "🎉",
    name: "Activities & Celebration",
    emojis: [
      "🎉", "🎊", "🎈", "🎂", "🎁", "🪄", "🪅", "🎆", "🎇", "🧨",
      "✨", "🎃", "🎄", "🎋", "🎍", "🎎", "🎏", "🎐", "🎀", "🎗️",
      "🎟️", "🎫", "🏆", "🥇", "🥈", "🥉", "⚽", "🏀", "🏈", "⚾",
      "🥎", "🎾", "🏐", "🏉", "🥏", "🎳", "🏏", "🏑", "🏒", "🏓",
      "🏸", "🥊", "🥋", "🥅", "⛳", "⛸️", "🎣", "🎽", "🎿", "🎯",
      "🪀", "🪁", "🎱", "🔮", "🎮", "🕹️", "🎰", "🎲", "🧩", "🧸",
      "🪩", "🃏", "🎭", "🎨", "🎬", "🎤", "🎧", "🎼", "🎹", "🥁",
      "🎷", "🎺", "🎸", "🎻",
    ],
  },
  {
    id: "nature",
    icon: "🐶",
    name: "Animals & Nature",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐻‍❄️", "🐨",
      "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤",
      "🦆", "🦅", "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛",
      "🦋", "🐌", "🐞", "🐜", "🪰", "🪲", "🦟", "🦗", "🕷️", "🦂",
      "🐢", "🐍", "🦎", "🐙", "🦑", "🦐", "🦞", "🦀", "🐡", "🐠",
      "🐟", "🐬", "🐳", "🐋", "🦈", "🦭", "🐊", "🐅", "🐆", "🦓",
      "🦍", "🐘", "🦛", "🦏", "🐪", "🦒", "🦘", "🦬", "🐃", "🐂",
      "🐄", "🐎", "🐖", "🐏", "🐑", "🐐", "🦌", "🐕", "🐈", "🐓",
      "🦃", "🦚", "🦜", "🦢", "🦩", "🕊️", "🐇", "🦝", "🦨", "🦡",
    ],
  },
];

export function EmojiPicker({ onSelect, onClose }) {
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0].id);
  const scrollContainerRef = useRef(null);

  const currentCategoryData =
    CATEGORIES.find((c) => c.id === activeCategory) || CATEGORIES[0];

  return (
    <div className="flex flex-col w-[300px] sm:w-[320px] h-[300px] bg-surface-raise border border-ink/15 shadow-2xl rounded-2xl overflow-hidden z-50 text-ink animate-in fade-in zoom-in-95 duration-150 select-none">
      {/* WhatsApp-style Category Tabs */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-ink/5 border-b border-ink/10 shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {CATEGORIES.map((cat) => {
            const isActive = cat.id === activeCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveCategory(cat.id);
                  if (scrollContainerRef.current) {
                    scrollContainerRef.current.scrollTop = 0;
                  }
                }}
                className={`w-8 h-8 flex items-center justify-center text-lg rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? "bg-surface-raise shadow-sm scale-105 border border-ink/10"
                    : "opacity-60 hover:opacity-100 hover:bg-ink/5"
                }`}
                title={cat.name}
              >
                {cat.icon}
              </button>
            );
          })}
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close emoji picker"
            className="w-7 h-7 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-ink/10 rounded-full transition-colors cursor-pointer shrink-0 ml-1 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Emoji Grid (All options like WhatsApp) */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto p-2.5 scroll-smooth min-h-0"
      >
        <div className="grid grid-cols-8 gap-1">
          {currentCategoryData.emojis.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              onClick={() => onSelect(emoji)}
              className="w-8 h-8 flex items-center justify-center text-xl hover:bg-ink/10 rounded-lg transition-transform hover:scale-125 active:scale-95 cursor-pointer"
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
