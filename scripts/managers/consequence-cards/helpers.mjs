export const CARD_FLAG = "consequenceCard"

export function capitalizeDamageType(type) {
   return String(type || "untyped")
      .replace(/[-_]+/g, " ")
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export function staticMethods(cls) {
   return Object.fromEntries(
      Object.getOwnPropertyNames(cls)
         .filter((name) => !["length", "name", "prototype"].includes(name))
         .map((name) => [name, cls[name]]),
   )
}
