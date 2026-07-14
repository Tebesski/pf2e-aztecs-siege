export function staticMethods(cls) {
   return Object.fromEntries(
      Object.getOwnPropertyNames(cls)
         .filter((name) => !["length", "name", "prototype"].includes(name))
         .map((name) => [name, cls[name]]),
   )
}
