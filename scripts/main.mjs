import { SiegeWeaponManager } from "./managers/sheet-manager.mjs"
import { SiegeActionsManager } from "./managers/actions.mjs"
import { SiegeCrewManager } from "./managers/crew.mjs"
import { AmmunitionManager } from "./managers/ammunition.mjs"
import { SiegePortableManager } from "./managers/portable.mjs"
import { SiegeChatManager } from "./managers/chat.mjs"
import { SiegeSFXManager } from "./managers/sfx.mjs"
import { SiegeTokenManager } from "./managers/token.mjs"
import { SiegeSocketManager } from "./managers/sockets.mjs"
import { SiegeSettings } from "./managers/settings.mjs"
import { HaulManager } from "./managers/haul.mjs"
import { VehicleEntryManager } from "./managers/entry.mjs"
import { VehicleLoadManager } from "./managers/vehicle-load.mjs"
import { SiegeKeybindings } from "./managers/keybindings.mjs"
import { SiegeMacros } from "./macros/index.mjs"
import { capitalize } from "./utils.mjs"

SiegeSettings.initHooks()
SiegeWeaponManager.initHooks()
SiegeActionsManager.initHooks()
SiegeCrewManager.initHooks()
AmmunitionManager.initHooks()
SiegePortableManager.initHooks()
SiegeChatManager.initHooks()
SiegeSFXManager.initHooks()
SiegeTokenManager.initHooks()
SiegeSocketManager.initHooks()
HaulManager.initHooks()
VehicleEntryManager.initHooks()
VehicleLoadManager.initHooks()
SiegeKeybindings.initHooks()

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
      "combat-vehicle": "Combat Vehicle",
      artillery: "Artillery",
   }
   
   
   
   
   const cfg = CONFIG.PF2E || {}
   const targets = [
      "vehicleTraits",
      "actorTraits",
      "creatureTraits",
      "weaponTraits",
   ]
   for (const key of targets) {
      if (cfg[key] && typeof cfg[key] === "object")
         Object.assign(cfg[key], extraTraits)
   }
   
   
   try {
      const desc =
         cfg.Actor?.documentClasses?.vehicle?.schema?.fields?.system?.fields
            ?.traits?.fields?.value?.element
      
      void desc
   } catch (e) {
      
   }
})

Handlebars.registerHelper("capitalize", capitalize)
