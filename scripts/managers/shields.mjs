import { MODULE_ID } from "../constants.mjs"
import { tKey } from "../utils.mjs"
import { ModuleItemUI } from "../ui/module-tab.mjs"
import { VehicleModulesManager } from "./modules.mjs"
import { shieldActionMethods } from "./shields/actions.mjs"
import { shieldChatMethods } from "./shields/chat.mjs"

export { REPAIR_SHIELDS_SOURCE_KEY } from "./shields/constants.mjs"

export class VehicleShieldManager {
   static _pendingBlockShieldIds = new Map()

   static initHooks() {
      Hooks.on("preDeleteItem", (item, options, userId) =>
         this._onPreDeleteItem(item, options, userId),
      )
      Hooks.on("deleteItem", (item, options, userId) =>
         this._onDeleteItem(item, options, userId),
      )
      Hooks.on("updateCombat", (combat, update) =>
         this._onUpdateCombat(combat, update),
      )
      Hooks.on("renderChatMessageHTML", (message, html) =>
         this._onRenderChatMessageHTML(message, html),
      )
   }

   static breakThreshold(maxHp) {
      const max = Math.max(0, Number(maxHp) || 0)
      return Math.floor(max / 2)
   }

   static isBroken(currentHp, maxHp) {
      return Number(currentHp) <= this.breakThreshold(maxHp)
   }

   static shieldStates(vehicle) {
      return vehicle?.getFlag?.(MODULE_ID, "moduleShields") || {}
   }

   static async setShieldStates(vehicle, states) {
      if (!states || Object.keys(states).length === 0) {
         await vehicle.unsetFlag(MODULE_ID, "moduleShields")
         return
      }
      await vehicle.setFlag(MODULE_ID, "moduleShields", states, {
         siegeModuleSync: true,
      })
   }

   static getShieldState(vehicle, sourceKey) {
      return this.shieldStates(vehicle)[sourceKey] || null
   }

   static collectShieldEntries(vehicle) {
      const entries = []
      for (const moduleItem of VehicleModulesManager.activeModules(vehicle)) {
         const flags = ModuleItemUI.normalizeFlags(
            moduleItem.getFlag(MODULE_ID, "vehicleModule") || {},
         )
         if (flags.moduleType !== "vehicle") continue
         for (const entry of flags.entries) {
            if (entry.type !== "shield") continue
            const sourceKey = VehicleModulesManager._sourceKey(
               moduleItem,
               entry.id,
            )
            entries.push({ moduleItem, entry, sourceKey })
         }
      }
      return entries
   }

   static hasShieldModules(vehicle) {
      return this.collectShieldEntries(vehicle).length > 0
   }

   static shieldName(moduleItem, entry) {
      return String(entry.name || moduleItem.name || tKey("Shield.DefaultName"))
   }

   static normalizeShieldEntry(entry = {}, moduleItem = null) {
      return {
         acBonus: Math.max(0, Number(entry.acBonus) || 0),
         hp: Math.max(1, Number(entry.hp) || 20),
         hardness: Math.max(0, Number(entry.hardness) || 0),
         speedPenalty: Math.max(0, Number(entry.speedPenalty) || 0),
         name: entry.name || moduleItem?.name || "",
      }
   }

   static buildShieldState(moduleItem, entry, sourceKey, existing = {}) {
      const norm = this.normalizeShieldEntry(entry, moduleItem)
      const maxHp = norm.hp
      const currentHp =
         existing.currentHp !== undefined
            ? Math.min(maxHp, Math.max(0, Number(existing.currentHp) || 0))
            : maxHp
      return {
         sourceKey,
         moduleItemId: moduleItem.id,
         entryId: entry.id,
         name: this.shieldName(moduleItem, entry),
         acBonus: norm.acBonus,
         maxHp,
         currentHp,
         hardness: norm.hardness,
         speedPenalty: norm.speedPenalty,
         shieldItemId: existing.shieldItemId || "",
         actionItemId: existing.actionItemId || "",
         broken: this.isBroken(currentHp, maxHp),
      }
   }

   static async syncShieldStates(vehicle, modules) {
      const current = foundry.utils.deepClone(this.shieldStates(vehicle))
      const next = {}
      let changed = false

      for (const moduleItem of modules) {
         const flags = ModuleItemUI.normalizeFlags(
            moduleItem.getFlag(MODULE_ID, "vehicleModule") || {},
         )
         if (flags.moduleType !== "vehicle") continue
         for (const entry of flags.entries) {
            if (entry.type !== "shield") continue
            const sourceKey = VehicleModulesManager._sourceKey(
               moduleItem,
               entry.id,
            )
            const built = this.buildShieldState(
               moduleItem,
               entry,
               sourceKey,
               current[sourceKey] || {},
            )
            next[sourceKey] = built
            if (JSON.stringify(current[sourceKey]) !== JSON.stringify(built))
               changed = true
         }
      }

      if (Object.keys(current).length !== Object.keys(next).length) changed = true
      if (changed) await this.setShieldStates(vehicle, next)
      return next
   }

}

Object.assign(
   VehicleShieldManager,
   shieldActionMethods,
   shieldChatMethods,
)
