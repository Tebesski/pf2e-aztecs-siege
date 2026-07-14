import { MODULE_ID, DEFAULT_SIEGE_ACTION_FLAGS } from "../constants.mjs"
import { slugify, tKey } from "../utils.mjs"
import { ModuleItemUI } from "../ui/module-tab.mjs"
import { VehicleModulesManager } from "./modules.mjs"
import { SiegeSocketManager } from "./sockets.mjs"

const DEFAULT_LIGHT_IMG = "icons/magic/light/orbs-firefly-hand-yellow.webp"

export class VehicleLightManager {
   static lightName(moduleItem, entry) {
      return String(entry.name || moduleItem?.name || tKey("Light.DefaultName"))
   }

   static normalizeLightEntry(entry = {}, moduleItem = null) {
      const light = ModuleItemUI._normalizeLightData(entry.light)
      return {
         name: this.lightName(moduleItem, entry),
         img: entry.img || moduleItem?.img || DEFAULT_LIGHT_IMG,
         light,
      }
   }

   static lightActionData(vehicle, moduleItem, entry, sourceKey) {
      const data = this.normalizeLightEntry(entry, moduleItem)
      const config = data.light.config || {}
      return {
         name: data.name,
         type: "action",
         img: data.img,
         system: {
            description: {
               value: tKey("Light.ActivateDesc", {
                  name: data.name,
                  dim: Math.max(0, Number(config.dim) || 0),
                  bright: Math.max(0, Number(config.bright) || 0),
               }),
            },
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: ["light"] },
            slug: slugify(`light-${data.name}`),
         },
         flags: {
            [MODULE_ID]: {
               siegeAction: {
                  ...DEFAULT_SIEGE_ACTION_FLAGS,
                  isLightActivate: true,
                  lightSourceKey: sourceKey,
                  usesAmmunition: false,
                  needsIgnition: false,
                  skills: [],
               },
               moduleGenerated: VehicleModulesManager._generatedFlag(
                  sourceKey,
                  moduleItem,
                  entry,
                  "action",
               ),
            },
         },
      }
   }

   static effectName(lightName) {
      return tKey("Light.ActivatedEffect", { name: lightName })
   }

   static async cleanupInactiveEffects(vehicle, activeSourceKeys = new Set()) {
      const ids = (vehicle.itemTypes?.effect || [])
         .filter((effect) => {
            const sourceKey = effect.getFlag(MODULE_ID, "lightActivated")?.sourceKey
            return sourceKey && !activeSourceKeys.has(sourceKey)
         })
         .map((effect) => effect.id)
      if (ids.length)
         await vehicle.deleteEmbeddedDocuments("Item", ids, { siegeModuleSync: true })
   }

   static _entryForAction(vehicle, actionItem) {
      const generated = actionItem.getFlag(MODULE_ID, "moduleGenerated") || {}
      const sourceKey =
         actionItem.getFlag(MODULE_ID, "siegeAction")?.lightSourceKey ||
         generated.sourceKey
      if (!sourceKey) return null

      const moduleItem =
         (generated.moduleItemId && vehicle.items.get(generated.moduleItemId)) ||
         vehicle.items.find((item) => item.uuid === generated.moduleItemUuid)
      if (!moduleItem) return null

      const flags = ModuleItemUI.normalizeFlags(
         moduleItem.getFlag(MODULE_ID, "vehicleModule") || {},
      )
      const entry = flags.entries.find(
         (candidate) =>
            candidate.type === "light" &&
            (candidate.id === generated.entryId ||
               VehicleModulesManager._sourceKey(moduleItem, candidate.id) === sourceKey),
      )
      if (!entry) return null
      return { moduleItem, entry, sourceKey }
   }

   static _tokenLightRule(lightData = {}) {
      const config =
         lightData.config && typeof lightData.config === "object"
            ? foundry.utils.deepClone(lightData.config)
            : {}
      if (config.dim === undefined) config.dim = 10
      if (config.bright === undefined) config.bright = 5

      try {
         const value = new foundry.data.LightData(config).toObject()
         return { key: "TokenLight", value }
      } catch (_err) {
         return null
      }
   }

   static async activateLight(vehicle, actionItem, crewman) {
      const found = this._entryForAction(vehicle, actionItem)
      if (!found) {
         ui.notifications.warn(tKey("Light.NotFound"))
         return false
      }

      const { moduleItem, entry, sourceKey } = found
      const data = this.normalizeLightEntry(entry, moduleItem)
      const rule = this._tokenLightRule(data.light)
      const config = data.light.config || {}
      const dim = Math.max(0, Number(config.dim) || 0)
      const bright = Math.max(0, Number(config.bright) || 0)
      if (!rule) {
         ui.notifications.warn(tKey("Light.InvalidConfig"))
         return false
      }

      const effectName = this.effectName(data.name)
      const existingEffects = (vehicle.itemTypes?.effect || [])
         .filter(
            (effect) =>
               effect.getFlag(MODULE_ID, "lightActivated")?.sourceKey ===
                  sourceKey ||
               (effect.name === effectName &&
                  !effect.getFlag(MODULE_ID, "lightActivated")?.sourceKey),
         )
      const existingIds = existingEffects.map((effect) => effect.id)
      if (existingIds.length) {
         await SiegeSocketManager.modifySiegeItem(vehicle.uuid, "delete", existingIds, {
            siegeModuleSync: true,
         })
         await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: crewman }),
            content: tKey("Chat.LightDeactivated", {
               crewman: crewman?.name || "",
               light: data.name,
               vehicle: vehicle.name,
            }),
         })
         return { ok: true, enabled: false }
      }

      await SiegeSocketManager.modifySiegeItem(
         vehicle.uuid,
         "create",
         [
            {
               name: effectName,
               type: "effect",
               img: actionItem.img || data.img,
               system: {
                  level: { value: 1 },
                  duration: {
                     value: -1,
                     unit: "unlimited",
                     sustained: false,
                     expiry: null,
                  },
                  description: {
                     value: tKey("Light.ActivatedEffectDesc", {
                        name: data.name,
                        dim,
                        bright,
                     }),
                  },
                  rules: [rule],
                  tokenIcon: { show: true },
               },
               flags: {
                  [MODULE_ID]: {
                     lightActivated: {
                        sourceKey,
                        moduleItemId: moduleItem.id,
                        entryId: entry.id,
                        activatorActorId: crewman?.id || "",
                     },
                  },
               },
            },
         ],
         { siegeModuleSync: true },
      )

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.LightActivated", {
            crewman: crewman?.name || "",
            light: data.name,
            vehicle: vehicle.name,
         }),
      })

      return { ok: true, enabled: true }
   }
}
