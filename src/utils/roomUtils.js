/**
 * Generates an 8-character unique room code: 4 uppercase letters + 4 digits.
 * Formatted with a hyphen for readability: e.g. "WHKZ-4829"
 * 
 * Uses crypto.getRandomValues() for cryptographic randomness.
 * Namespace size: 26^4 * 9000 = 4,112,856,000 (~4.11 billion) unique combinations.
 */
export function generateRoomId() {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const letterBytes = new Uint8Array(4);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(letterBytes);
  } else {
    for (let i = 0; i < 4; i++) {
      letterBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let letters = "";
  for (let i = 0; i < 4; i++) {
    letters += LETTERS[letterBytes[i] % LETTERS.length];
  }

  // 4-digit number between 1000 and 9999
  const numBytes = new Uint16Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(numBytes);
  } else {
    numBytes[0] = Math.floor(Math.random() * 65536);
  }
  const numbers = 1000 + (numBytes[0] % 9000);

  return `${letters}-${numbers}`;
}
