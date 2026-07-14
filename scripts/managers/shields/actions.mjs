import { MODULE_ID, DEFAULT_SIEGE_ACTION_FLAGS } from "../../constants.mjs"
import { slugify, tKey } from "../../utils.mjs"
import { VehicleModulesManager } from "../modules.mjs"
import { SiegeSocketManager } from "../sockets.mjs"
import { REPAIR_SHIELDS_SOURCE_KEY } from "./constants.mjs"
import { staticMethods } from "./helpers.mjs"

class ShieldActionMixin {

   static shieldActionData(vehicle, moduleItem, entry, sourceKey, state) {
      const name = state.name
      return {
         name,
         type: "action",
         img: entry.img || moduleItem.img || "icons/equipment/shield/kite-bronze-boss-brown.webp",
         system: {
            description: {
               value: tKey("Shield.ActivateDesc", {
                  name,
                  ac: state.acBonus,
                  hp: state.currentHp,
                  maxHp: state.maxHp,
                  hardness: state.hardness,
               }),
            },
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: [] },
            slug: slugify(`shield-${name}`),
         },
         flags: {
            [MODULE_ID]: {
               siegeAction: {
                  ...DEFAULT_SIEGE_ACTION_FLAGS,
                  isShieldActivate: true,
                  shieldSourceKey: sourceKey,
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



   static repairShieldsActionData(vehicle) {
      const existing = vehicle.items.find(
         (item) =>
            item.getFlag(MODULE_ID, "moduleGenerated")?.sourceKey ===
            REPAIR_SHIELDS_SOURCE_KEY,
      )
      const skills =
         existing?.getFlag(MODULE_ID, "siegeAction")?.skills ||
         [{ name: "crafting", loreName: "", dc: "" }]

      return {
         name: tKey("Shield.RepairShieldsAction"),
         type: "action",
         img: "icons/tools/smithing/furnace-fire-metal-orange.webp",
         system: {
            description: { value: tKey("Shield.RepairShieldsDesc") },
            actionType: { value: "action" },
            actions: { value: 1 },
            traits: { value: ["manipulate"] },
            slug: "repair-shields",
         },
         flags: {
            [MODULE_ID]: {
               siegeAction: {
                  ...DEFAULT_SIEGE_ACTION_FLAGS,
                  isRepairShields: true,
                  skills: foundry.utils.deepClone(skills),
               },
               moduleGenerated: {
                  kind: "action",
                  sourceKey: REPAIR_SHIELDS_SOURCE_KEY,
                  moduleItemId: "",
                  moduleItemUuid: "",
                  entryId: REPAIR_SHIELDS_SOURCE_KEY,
               },
            },
         },
      }
   }



   static shieldItemData(vehicle, moduleItem, entry, sourceKey, state) {
      const name = state.name
      return {
         name,
         type: "shield",
         img: entry.img || moduleItem.img || "icons/equipment/shield/kite-bronze-boss-brown.webp",
         system: {
            description: {
               value: tKey("Shield.ItemDesc", {
                  name,
                  ac: state.acBonus,
                  hardness: state.hardness,
               }),
            },
            acBonus: state.acBonus,
            hardness: state.hardness,
            speedPenalty: state.speedPenalty,
            hp: {
               value: state.currentHp,
               max: state.maxHp,
            },
            equipped: {
               carryType: "held",
               handsHeld: 1,
            },
            bulk: { value: 0 },
            level: { value: 0 },
            traits: { value: [], rarity: "common" },
         },
         flags: {
            [MODULE_ID]: {
               moduleGenerated: {
                  ...VehicleModulesManager._generatedFlag(
                     sourceKey,
                     moduleItem,
                     entry,
                     "shield",
                  ),
                  shieldSourceKey: sourceKey,
               },
            },
         },
      }
   }



   static activeShieldEffects(vehicle) {
      return vehicle.itemTypes.effect.filter((effect) =>
         effect.getFlag(MODULE_ID, "shieldActivated"),
      )
   }



   static isShieldActive(vehicle, sourceKey) {
      return this.activeShieldEffects(vehicle).some(
         (effect) =>
            effect.getFlag(MODULE_ID, "shieldActivated")?.sourceKey === sourceKey,
      )
   }



   static _shieldItemForState(vehicle, state) {
      if (!vehicle || !state) return null
      return (
         (state.shieldItemId ? vehicle.items.get(state.shieldItemId) : null) ||
         vehicle.items.find(
            (item) =>
               item.getFlag(MODULE_ID, "moduleGenerated")?.sourceKey ===
                  state.sourceKey &&
               item.getFlag(MODULE_ID, "moduleGenerated")?.kind === "shield",
         ) ||
         null
      )
   }



   static _activeShieldOptions(vehicle) {
      return this.activeShieldEffects(vehicle)
         .map((effect) => {
            const data = effect.getFlag(MODULE_ID, "shieldActivated") || {}
            const state = this.getShieldState(vehicle, data.sourceKey)
            const shieldItem = this._shieldItemForState(vehicle, state)
            if (!state || !shieldItem) return null
            if (state.broken || this.isBroken(state.currentHp, state.maxHp))
               return null
            return {
               sourceKey: data.sourceKey,
               shieldItemId: data.shieldItemId || shieldItem.id,
               label: `${state.name} (${state.currentHp}/${state.maxHp} HP, AC +${state.acBonus}, Hardness ${state.hardness})`,
               state,
            }
         })
         .filter(Boolean)
   }



   static effectName(shieldName) {
      return tKey("Shield.ActivatedEffect", { name: shieldName })
   }



   static _effectRules(state) {
      const rules = [
         {
            key: "FlatModifier",
            selector: "ac",
            value: state.acBonus,
            type: "circumstance",
         },
         {
            key: "ActiveEffectLike",
            mode: "override",
            path: "system.attributes.shield.raised",
            predicate: [
               "self:shield:equipped",
               { nor: ["self:shield:broken", "self:shield:destroyed"] },
            ],
            value: true,
         },
      ]
      if (state.speedPenalty > 0) {
         rules.push({
            key: "FlatModifier",
            selector: "land-speed",
            value: -state.speedPenalty,
         })
      }
      return rules
   }



   static async activateShield(vehicle, actionItem, crewman) {
      const sourceKey = actionItem.getFlag(MODULE_ID, "siegeAction")?.shieldSourceKey
      if (!sourceKey) return false

      const state = this.getShieldState(vehicle, sourceKey)
      if (!state) {
         ui.notifications.warn(tKey("Shield.NotFound"))
         return false
      }
      if (state.broken || this.isBroken(state.currentHp, state.maxHp)) {
         ui.notifications.warn(tKey("Shield.Broken", { name: state.name }))
         return false
      }

      const shieldItem = state.shieldItemId
         ? vehicle.items.get(state.shieldItemId)
         : vehicle.items.find(
              (item) =>
                 item.getFlag(MODULE_ID, "moduleGenerated")?.sourceKey ===
                    sourceKey &&
                 item.getFlag(MODULE_ID, "moduleGenerated")?.kind === "shield",
           )
      if (!shieldItem) {
         ui.notifications.warn(tKey("Shield.ItemMissing"))
         return false
      }

      const combat = game.combat
      const activationKey = combat
         ? `${combat.round}-${combat.turn}`
         : `none-${Date.now()}`

      await this._equipShieldItem(vehicle, shieldItem)

      const effectName = this.effectName(state.name)
      const existing = this.activeShieldEffects(vehicle).filter(
         (e) =>
            e.name === effectName ||
            e.getFlag(MODULE_ID, "shieldActivated")?.sourceKey === sourceKey,
      )
      if (existing.length)
         await SiegeSocketManager.modifySiegeItem(
            vehicle.uuid,
            "delete",
            existing.map((e) => e.id),
            { siegeShieldSync: true },
         )
      const existingCrewEffects = crewman.itemTypes.effect.filter((effect) => {
         const data = effect.getFlag(MODULE_ID, "shieldActivator")
         return data?.vehicleUuid === vehicle.uuid && data?.sourceKey === sourceKey
      })
      if (existingCrewEffects.length)
         await crewman.deleteEmbeddedDocuments(
            "Item",
            existingCrewEffects.map((effect) => effect.id),
            { siegeShieldSync: true },
         )

      await SiegeSocketManager.modifySiegeItem(vehicle.uuid, "create", [
         {
            name: effectName,
            type: "effect",
            img: actionItem.img || shieldItem.img,
            system: {
               level: { value: 1 },
               duration: {
                  value: -1,
                  unit: "unlimited",
                  sustained: false,
                  expiry: null,
               },
               description: {
                  value: tKey("Shield.ActivatedEffectDesc", {
                     name: state.name,
                     ac: state.acBonus,
                  }),
               },
               rules: this._effectRules(state),
               tokenIcon: { show: true },
            },
            flags: {
               [MODULE_ID]: {
                  shieldActivated: {
                     sourceKey,
                     shieldItemId: shieldItem.id,
                     activatorActorId: crewman.id,
                     activatorActorUuid: crewman.uuid,
                  },
               },
            },
         },
      ])

      await crewman.createEmbeddedDocuments(
         "Item",
         [
            {
               name: tKey("Shield.ActivatorEffect", { name: state.name }),
               type: "effect",
               img: actionItem.img || shieldItem.img,
               system: {
                  level: { value: 1 },
                  duration: {
                     value: 1,
                     unit: "rounds",
                     sustained: false,
                     expiry: "turn-start",
                  },
                  description: {
                     value: tKey("Shield.ActivatorEffectDesc", {
                        name: state.name,
                        vehicle: vehicle.name,
                     }),
                  },
                  tokenIcon: { show: true },
               },
               flags: {
                  [MODULE_ID]: {
                     shieldActivator: {
                        vehicleUuid: vehicle.uuid,
                        vehicleId: vehicle.id,
                        sourceKey,
                        shieldItemId: shieldItem.id,
                        activationKey,
                     },
                  },
               },
            },
         ],
         { siegeShieldSync: true },
      )

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: crewman }),
         content: tKey("Chat.ShieldActivated", {
            crewman: crewman.name,
            shield: state.name,
            vehicle: vehicle.name,
         }),
      })

      return true
   }



   static async _equipShieldItem(vehicle, shieldItem) {
      const updates = []
      for (const item of vehicle.items.filter((i) => i.type === "shield")) {
         if (item.id === shieldItem.id) {
            updates.push({
               _id: item.id,
               "system.equipped.carryType": "held",
               "system.equipped.handsHeld": 1,
            })
         } else if (item.system?.equipped?.carryType === "held") {
            updates.push({
               _id: item.id,
               "system.equipped.carryType": "worn",
               "system.equipped.handsHeld": 0,
            })
         }
      }
      if (updates.length)
         await SiegeSocketManager.modifySiegeItem(vehicle.uuid, "update", updates)
   }



   static async applyShieldRepair(vehicle, sourceKey, amount) {
      if (!vehicle || !sourceKey) return false
      if (game.user.isGM || !globalThis.siegeSocket)
         return this._doApplyShieldRepair(vehicle.uuid, sourceKey, amount)
      return globalThis.siegeSocket.executeAsGM(
         "applyShieldRepair",
         vehicle.uuid,
         sourceKey,
         amount,
      )
   }



   static async _doApplyShieldRepair(vehicleUuid, sourceKey, amount) {
      const vehicle = await fromUuid(vehicleUuid).catch(() => null)
      if (!vehicle || vehicle.type !== "vehicle") return false
      const states = foundry.utils.deepClone(this.shieldStates(vehicle))
      const state = states[sourceKey]
      if (!state) {
         const entry = this.collectShieldEntries(vehicle).find(
            (shield) => shield.sourceKey === sourceKey,
         )
         if (!entry) return false
         states[sourceKey] = this.buildShieldState(
            entry.moduleItem,
            entry.entry,
            sourceKey,
         )
      }
      const currentState = states[sourceKey]

      const shieldItem = currentState.shieldItemId
         ? vehicle.items.get(currentState.shieldItemId)
         : this._shieldItemForState(vehicle, currentState)
      const maxHp = Math.max(
         1,
         Number(shieldItem?.system?.hp?.max ?? currentState.maxHp) || 1,
      )
      const currentHp = Math.min(
         maxHp,
         Math.max(
            0,
            Number(shieldItem?.system?.hp?.value ?? currentState.currentHp) || 0,
         ),
      )
      const delta = Number.isFinite(Number(amount)) ? Number(amount) : 0
      const nextHp = Math.min(maxHp, Math.max(0, currentHp + delta))
      currentState.currentHp = nextHp
      currentState.maxHp = maxHp
      currentState.broken = this.isBroken(nextHp, maxHp)
      if (shieldItem) currentState.shieldItemId = shieldItem.id
      states[sourceKey] = currentState
      await this.setShieldStates(vehicle, states)

      if (shieldItem) {
         await SiegeSocketManager.modifySiegeItem(vehicle.uuid, "update", [
            {
               _id: shieldItem.id,
               "system.hp.value": nextHp,
               "system.hp.max": maxHp,
            },
         ])
      }
      if (globalThis.siegeSocket && vehicle.id)
         globalThis.siegeSocket.executeForEveryone(
            "refreshVehicleHud",
            vehicle.id,
         )
      return {
         sourceKey,
         name: currentState.name,
         previousHp: currentHp,
         nextHp,
         maxHp,
         amount: Math.abs(nextHp - currentHp),
         hardness: currentState.hardness,
      }
   }



   static async applyShieldBlockDamage(
      vehicle,
      block,
      damage,
      userId = game.user.id,
   ) {
      if (!vehicle || !block) return false
      if (game.user.isGM || !globalThis.siegeSocket) {
         return this._doApplyShieldBlockDamage(
            vehicle.uuid,
            block,
            damage,
            userId,
         )
      }
      return globalThis.siegeSocket.executeAsGM(
         "applyShieldBlockDamage",
         vehicle.uuid,
         block,
         damage,
         userId,
      )
   }



   static async _doApplyShieldBlockDamage(
      vehicleUuid,
      block,
      damage,
      userId = null,
   ) {
      const vehicle = await fromUuid(vehicleUuid).catch(() => null)
      if (!vehicle || vehicle.type !== "vehicle") return false

      const states = foundry.utils.deepClone(this.shieldStates(vehicle))
      const sourceKey =
         block.sourceKey ||
         Object.entries(states).find(
            ([, state]) => state.shieldItemId === block.shieldItemId,
         )?.[0] ||
         ""
      const state = states[sourceKey]
      if (!state) {
         this._notifyShieldBlockUser(userId, "warn", "Shield.NotFound")
         return false
      }

      const shieldItem = this._shieldItemForState(vehicle, state)
      if (!shieldItem) {
         this._notifyShieldBlockUser(userId, "warn", "Shield.ItemMissing")
         return false
      }
      if (!this.isShieldActive(vehicle, sourceKey)) {
         this._notifyShieldBlockUser(userId, "warn", "Shield.NotRaised")
         return false
      }

      const incomingDamage = Math.max(0, Math.floor(Number(damage) || 0))
      if (incomingDamage <= 0) return false

      const maxHp = Math.max(
         1,
         Number(shieldItem.system?.hp?.max ?? state.maxHp) || 1,
      )
      const currentHp = Math.min(
         maxHp,
         Math.max(
            0,
            Number(shieldItem.system?.hp?.value ?? state.currentHp) || 0,
         ),
      )
      if (currentHp <= 0 || this.isBroken(currentHp, maxHp)) {
         this._notifyShieldBlockUser(userId, "warn", "Shield.Broken", {
            name: state.name,
         })
         return false
      }

      const shieldHardness = Math.max(
         0,
         Number(shieldItem.system?.hardness ?? state.hardness) || 0,
      )
      const vehicleHardness = Math.max(
         0,
         Number(
            vehicle.system?.attributes?.hardness?.value ??
               vehicle.system?.attributes?.hardness,
         ) || 0,
      )
      const absorbedByShield = Math.min(shieldHardness, incomingDamage)
      const damageAfterShield = Math.max(0, incomingDamage - absorbedByShield)
      const shieldDamage = Math.min(currentHp, damageAfterShield)

      const nextShieldHp = Math.max(0, currentHp - shieldDamage)
      const vehicleHp = vehicle.system?.attributes?.hp || {}
      const vehicleHpValue = Math.max(0, Number(vehicleHp.value) || 0)
      const broken = this.isBroken(nextShieldHp, maxHp)

      states[sourceKey] = {
         ...state,
         currentHp: nextShieldHp,
         maxHp,
         hardness: shieldHardness,
         shieldItemId: shieldItem.id,
         broken,
      }
      await this.setShieldStates(vehicle, states)

      const updates = [
         {
            _id: shieldItem.id,
            "system.hp.value": nextShieldHp,
            "system.hp.max": maxHp,
            "system.hardness": shieldHardness,
         },
      ]
      await vehicle.updateEmbeddedDocuments("Item", updates, {
         siegeModuleSync: true,
      })

      let vehicleDamage = 0
      if (damageAfterShield > 0) {
         const applied = await this._applyVehicleDamage(
            vehicle,
            block.targetUuid,
            damageAfterShield,
         )
         const currentVehicleHp = Math.max(
            0,
            Number(vehicle.system?.attributes?.hp?.value) || 0,
         )
         if (applied) {
            vehicleDamage = Math.max(0, vehicleHpValue - currentVehicleHp)
         } else {
            vehicleDamage = Math.max(0, damageAfterShield - vehicleHardness)
            if (vehicleDamage > 0) {
               await vehicle.update(
                  {
                     "system.attributes.hp.value": Math.max(
                        0,
                        vehicleHpValue - vehicleDamage,
                     ),
                  },
                  { damageTaken: vehicleDamage },
               )
            }
         }
      }

      if (broken) {
         const effects = this.activeShieldEffects(vehicle)
            .filter(
               (effect) =>
                  effect.getFlag(MODULE_ID, "shieldActivated")?.sourceKey ===
                  sourceKey,
            )
            .map((effect) => effect.id)
         if (effects.length)
            await vehicle.deleteEmbeddedDocuments("Item", effects, {
               siegeModuleSync: true,
            })
      }

      await ChatMessage.create({
         speaker: ChatMessage.getSpeaker({ actor: vehicle }),
         content: tKey("Chat.ShieldBlocked", {
            shield: state.name,
            vehicle: vehicle.name,
            incoming: incomingDamage,
            absorbed: absorbedByShield,
            shieldDamage,
            shieldHp: nextShieldHp,
            shieldMaxHp: maxHp,
            vehicleHardness,
            vehicleDamage,
         }),
      })

      if (globalThis.siegeSocket && vehicle.id)
         globalThis.siegeSocket.executeForEveryone(
            "refreshVehicleHud",
            vehicle.id,
         )

      return true
   }



   static async _applyVehicleDamage(vehicle, targetUuid, damage) {
      if (typeof vehicle?.applyDamage !== "function") return false
      const token = await this._tokenForVehicleDamage(vehicle, targetUuid)
      if (!token) return false
      await vehicle.applyDamage({
         damage,
         token,
         shieldBlockRequest: false,
      })
      return true
   }



   static async _tokenForVehicleDamage(vehicle, targetUuid) {
      if (targetUuid) {
         let doc = null
         try {
            doc = globalThis.fromUuidSync?.(targetUuid) || null
         } catch {
            doc = null
         }
         if (!doc) doc = await fromUuid(targetUuid).catch(() => null)
         const token = doc?.object ?? doc
         if (token?.actor) return token
      }
      return vehicle.getActiveTokens?.()[0] || null
   }



   static _notifyShieldBlockUser(userId, type, key, data = {}) {
      if (userId && userId !== game.user.id && globalThis.siegeSocket) {
         globalThis.siegeSocket.executeAsUser("notifyUser", userId, {
            type,
            key,
            data,
         })
         return
      }
      const message = tKey(key, data)
      if (type === "error") ui.notifications.error(message)
      else if (type === "warn") ui.notifications.warn(message)
      else ui.notifications.info(message)
   }
}

export const shieldActionMethods = staticMethods(ShieldActionMixin)
