/**
 * The kind and level of each spell, as shown beside its name (for example
 * "Conjuring · Basic"). Spells without an assigned kind and level are simply
 * left out, so they show their name alone.
 */
const SPELL_TYPE_LEVEL: Record<string, string> = {
  "Newkai Dodan": "Hex · Advanced",
  "Bendika": "Necromancy · Mastery",
  "Bendika Tah": "Necromancy · OP",
  "Mayban Dadoy Tron": "Necromancy · Mastery",
  "Tia Lua": "Necromancy · Basic",
  "Cau Lua": "Necromancy · Basic",
  "Hoa Boc": "Necromancy · Skilled",
  "Buc Tung Lua": "Necromancy · Skilled",
  "Mua Lua": "Necromancy · Advanced",
  "Chila Cao": "Necromancy · Skilled",
  "Handom Zitie Zumuc": "Necromancy · Skilled",
  "Bamburgh": "Necromancy · Advanced",
  "Thayma": "Conjuring · Basic",
  "Hipsy Titam": "Conjuring · Skilled",
  "Lazarus": "Conjuring · Skilled",
  "Cuoclot Sac Wonmuc Rook": "Conjuring · Advanced",
  "Anne Boleyn": "Conjuring · Mastery",
  "Hairy Balls": "Hex · Skilled",
  "Veiny Balls": "Hex · Advanced",
  "Shiny Balls": "Hex · Basic",
};

export function spellTypeLevel(spellName: string): string | null {
  return SPELL_TYPE_LEVEL[spellName] ?? null;
}
