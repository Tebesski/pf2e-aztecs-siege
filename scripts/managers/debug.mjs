import { MODULE_ID } from "../constants.mjs"















export class SiegeReloadDebug {
   static enabled = false

   static initHooks() {
      try {
         this.enabled =
            globalThis.localStorage?.getItem(`${MODULE_ID}:reload-debug`) === "1"
      } catch {
         this.enabled = false
      }
      globalThis.SiegeReloadDebug = this
   }

   static on() {
      this.enabled = true
      try {
         globalThis.localStorage?.setItem(`${MODULE_ID}:reload-debug`, "1")
      } catch {}
      console.log(`%c[reload]%c verbose tracing ENABLED`, "color:#2980b9;font-weight:bold", "")
      return true
   }

   static off() {
      this.enabled = false
      try {
         globalThis.localStorage?.removeItem(`${MODULE_ID}:reload-debug`)
      } catch {}
      console.log(`%c[reload]%c verbose tracing DISABLED`, "color:#c0392b;font-weight:bold", "")
      return false
   }

   static log(...args) {
      if (!this.enabled) return
      console.log(`%c[reload]`, "color:#2980b9;font-weight:bold", ...args)
   }

   static group(label) {
      if (!this.enabled) return
      console.groupCollapsed(`%c[reload] ${label}`, "color:#8e44ad;font-weight:bold")
   }

   static groupEnd() {
      if (!this.enabled) return
      console.groupEnd()
   }

   static table(rows) {
      if (!this.enabled) return
      console.table(rows)
   }
}
