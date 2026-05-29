import { SiegeWeaponManager } from "./managers/sheet.mjs"
import { SiegeActionsManager } from "./managers/actions.mjs"
import { SiegeCrewManager } from "./managers/crew.mjs"
import { AmmunitionManager } from "./managers/ammunition.mjs"
import { SiegePortableManager } from "./managers/portable.mjs"
import { SiegeChatManager } from "./managers/chat.mjs"
import { SiegeTokenManager } from "./managers/token.mjs"
import { SiegeSocketManager } from "./managers/sockets.mjs"
import { SiegeMacros } from "./macros/index.mjs"
import { capitalize } from "./utils.mjs"

SiegeWeaponManager.initHooks()
SiegeActionsManager.initHooks()
SiegeCrewManager.initHooks()
AmmunitionManager.initHooks()
SiegePortableManager.initHooks()
SiegeChatManager.initHooks()
SiegeTokenManager.initHooks()
SiegeSocketManager.initHooks()

globalThis.SiegeCrewManager = SiegeCrewManager
globalThis.SiegeMacros = SiegeMacros
globalThis.SiegePortableManager = SiegePortableManager

Hooks.once("init", () => {
   const extraTraits = {
      portable: "Portable",
      mounted: "Mounted",
      alchemical: "Alchemical",
      light: "Light",
      holy: "Holy",
      sonic: "Sonic",
      nonlethal: "Nonlethal",
   }
   Object.assign(CONFIG.PF2E.vehicleTraits, extraTraits)
})

Handlebars.registerHelper("capitalize", capitalize)
