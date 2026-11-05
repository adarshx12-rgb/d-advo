import { randomInt } from "node:crypto";

/** Letters that are hard to confuse when read aloud on stream or typed on a phone. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

export function generateRoomCode(isTaken: (code: string) => boolean): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
  throw new Error("Could not allocate a room code. Too many active rooms.");
}
