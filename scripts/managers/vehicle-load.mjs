import { MODULE_ID } from "../constants.mjs"
import {
   formatBulk,
   getAllActors,
   isEnterableVehicle,
   isSiege,
   slugify,
   tKey,
} from "../utils.mjs"
import { HaulManager } from "./haul.mjs"

const ENCUMBERED_UUID = "Compendium.pf2e.conditionitems.Item.D5mg6Tc7Jzrj6ro7"
const SIZE_LOAD_MULTIPLIER = {
   lg: 2,
   large: 2,
   huge: 4,
   grg: 8,
   gargantuan: 8,
}

export class VehicleLoadManager {
   static initHooks() {
      Hooks.once("ready", () => {
         if (!game.user.isGM) return
         for (const actor of game.actors.filter((a) => this.isTrackedVehicle(a)))
            this.sync(actor)
      })

      Hooks.on("createItem", (item, options) => this._onItemChanged(item, options))
      Hooks.on("updateItem", (item, changes, options) =>
         this._onItemChanged(item, options),
      )
      Hooks.on("deleteItem", (item, options) => this._onItemChanged(item, options))
      Hooks.on("updateActor", (actor, changes, options) =>
         this._onActorChanged(actor, options),
      )
   }

   static isTrackedVehicle(actor) {
      if (actor?.type !== "vehicle") return false
      return (
         isSiege(actor) ||
         isEnterableVehicle(actor) ||
         !!actor.getFlag?.(MODULE_ID, "enterable") ||
         actor.getFlag?.(MODULE_ID, "loadCapacity") !== undefined ||
         actor.getFlag?.(MODULE_ID, "bulk") !== undefined
      )
   }

   static rawLoadCapacity(vehicle) {
      const raw = vehicle?.getFlag?.(MODULE_ID, "loadCapacity")
      if (raw === "" || raw === null || raw === undefined) return null
      const value = Number(raw)
      return Number.isFinite(value) && value > 0 ? this._round(value) : null
   }

   static defaultLoadCapacity(vehicle) {
      if (!vehicle) return 0
      const ownBulk =
         Number(vehicle.getFlag?.(MODULE_ID, "bulk")) || HaulManager.sizeBulk(vehicle)
      const size = vehicle.system?.traits?.size?.value || "med"
      const multiplier = SIZE_LOAD_MULTIPLIER[size] || 1
      return this._round(ownBulk * multiplier)
   }

   static loadCapacity(vehicle) {
      return this.rawLoadCapacity(vehicle) ?? this.defaultLoadCapacity(vehicle)
   }

   static encumberedBulk(vehicle) {
      const max = this.maxBulk(vehicle)
      return Math.floor(max / 2)
   }

   static maxBulk(vehicle) {
      return this._round(this.loadCapacity(vehicle))
   }

   static currentBulk(vehicle) {
      if (!vehicle) return 0
      return this._round(HaulManager.inventoryBulk(vehicle))
   }

   static status(vehicle) {
      const max = this.maxBulk(vehicle)
      const capacity = max
      const encumberedBulk = this.encumberedBulk(vehicle)
      const current = this.currentBulk(vehicle)
      return {
         current,
         currentLabel: formatBulk(current),
         capacity,
         capacityLabel: formatBulk(capacity),
         encumberedBulk,
         encumberedLabel: formatBulk(encumberedBulk),
         max,
         maxLabel: formatBulk(max),
         encumbered: encumberedBulk > 0 && current >= encumberedBulk,
         atMax: max > 0 && current >= max,
         defaultCapacity: this.defaultLoadCapacity(vehicle),
      }
   }

   static isAtMax(vehicle) {
      return this.status(vehicle).atMax
   }

   static enteredCrew(vehicle) {
      const seen = new Map()
      for (const actor of getAllActors()) {
         if (!actor || seen.has(actor.id)) continue
         const entered = actor.itemTypes?.effect?.some(
            (e) =>
               e.getFlag(MODULE_ID, "isEntered") &&
               e.getFlag(MODULE_ID, "siegeId") === vehicle?.id,
         )
         if (entered) seen.set(actor.id, actor)
      }
      return [...seen.values()]
   }

   static async sync(vehicle) {
      if (!vehicle || !this.isTrackedVehicle(vehicle)) return null
      if (!game.user.isGM) return this.status(vehicle)
      await this._syncEnteredCargoItems(vehicle)
      const status = this.status(vehicle)
      await this._syncEncumberedCondition(vehicle, status.encumbered)
      await this._syncMaxSpeed(vehicle, status.atMax)
      this._refreshVehicleHud(vehicle)
      return status
   }

   static async _syncEncumberedCondition(vehicle, shouldHave) {
      const marked = vehicle.items.filter((item) =>
         item.getFlag(MODULE_ID, "vehicleLoadEncumbered"),
      )
      const anyEncumbered = vehicle.items.some((item) =>
         this._isEncumberedCondition(item),
      )

      if (shouldHave && !anyEncumbered) {
         const source = await fromUuid(ENCUMBERED_UUID).catch(() => null)
         if (!source) return
         const data = source.toObject()
         data.flags = foundry.utils.mergeObject(
            data.flags || {},
            { [MODULE_ID]: { vehicleLoadEncumbered: true } },
            { inplace: false },
         )
         await vehicle.createEmbeddedDocuments("Item", [data], {
            siegeLoadSync: true,
         })
      } else if (!shouldHave && marked.length > 0) {
         await vehicle.deleteEmbeddedDocuments(
            "Item",
            marked.map((item) => item.id),
            { siegeLoadSync: true },
         )
      }
   }

   static async _syncMaxSpeed(vehicle, atMax) {
      const stored = vehicle.getFlag(MODULE_ID, "loadPreviousSpeed")
      const currentSpeed = Number(vehicle.system?.details?.speed) || 0

      if (atMax) {
         const update = {}
         if (stored === undefined && currentSpeed > 0)
            update[`flags.${MODULE_ID}.loadPreviousSpeed`] = currentSpeed
         if (currentSpeed !== 0) update["system.details.speed"] = 0
         if (Object.keys(update).length > 0)
            await vehicle.update(update, { siegeLoadSync: true })
         return
      }

      if (stored !== undefined) {
         if (currentSpeed === 0 && Number(stored) > 0)
            await vehicle.update(
               { "system.details.speed": Number(stored) },
               { siegeLoadSync: true },
            )
         await vehicle.unsetFlag(MODULE_ID, "loadPreviousSpeed")
      }
   }

   static _isEncumberedCondition(item) {
      if (item?.type !== "condition") return false
      const slug = item.slug || item.system?.slug || slugify(item.name)
      return (
         slug === "encumbered" ||
         item.sourceId === ENCUMBERED_UUID ||
         item.getFlag(MODULE_ID, "vehicleLoadEncumbered")
      )
   }

   static _onItemChanged(item, options = {}) {
      if (!game.user.isGM || options?.siegeLoadSync) return
      const vehicles = this._affectedVehiclesForActor(item?.parent, item)
      for (const vehicle of vehicles) this.sync(vehicle)
   }

   static _onActorChanged(actor, options = {}) {
      if (!game.user.isGM || options?.siegeLoadSync) return
      const vehicles = this._affectedVehiclesForActor(actor)
      for (const vehicle of vehicles) this.sync(vehicle)
   }

   static _affectedVehiclesForActor(actor, item = null) {
      const vehicles = new Map()
      const add = (vehicle) => {
         if (vehicle && this.isTrackedVehicle(vehicle)) vehicles.set(vehicle.id, vehicle)
      }

      if (this.isTrackedVehicle(actor)) add(actor)

      const effects = actor?.itemTypes?.effect || []
      for (const effect of effects) {
         const vehicle = this._vehicleForEffect(effect)
         if (vehicle) add(vehicle)
      }

      const itemVehicle = this._vehicleForEffect(item)
      if (itemVehicle) add(itemVehicle)

      return [...vehicles.values()]
   }

   static _vehicleForEffect(effect) {
      if (!effect?.getFlag?.(MODULE_ID, "isEntered")) return null
      const id = effect.getFlag(MODULE_ID, "siegeId")
      return id ? game.actors.get(id) : null
   }

   static async _syncEnteredCargoItems(vehicle) {
      const entered = this.enteredCrew(vehicle)
      const wanted = new Map(
         entered.map((actor) => [actor.id, this._enteredCargoData(vehicle, actor)]),
      )
      const existing = vehicle.items.filter((item) =>
         item.getFlag(MODULE_ID, "isEnteredCargoItem"),
      )
      const keepByActor = new Map()
      const deleteIds = []

      for (const item of existing) {
         const actorId = item.getFlag(MODULE_ID, "enteredActorId")
         if (!wanted.has(actorId) || keepByActor.has(actorId)) {
            deleteIds.push(item.id)
            continue
         }
         keepByActor.set(actorId, item)
      }

      if (deleteIds.length > 0)
         await vehicle.deleteEmbeddedDocuments("Item", deleteIds, {
            siegeLoadSync: true,
         })

      const creates = []
      const updates = []
      for (const [actorId, data] of wanted.entries()) {
         const existingItem = keepByActor.get(actorId)
         if (!existingItem) {
            creates.push(data)
            continue
         }
         const currentBulk = Number(existingItem.system?.bulk?.value) || 0
         const nextBulk = Number(data.system.bulk.value) || 0
         const patch = { _id: existingItem.id }
         let changed = false
         if (existingItem.name !== data.name) {
            patch.name = data.name
            changed = true
         }
         if (existingItem.img !== data.img) {
            patch.img = data.img
            changed = true
         }
         if (this._round(currentBulk) !== this._round(nextBulk)) {
            patch["system.bulk.value"] = nextBulk
            changed = true
         }
         if ((Number(existingItem.system?.quantity) || 1) !== 1) {
            patch["system.quantity"] = 1
            changed = true
         }
         if ((existingItem.system?.size || "med") !== "med") {
            patch["system.size"] = "med"
            changed = true
         }
         const currentDesc = existingItem.system?.description?.value || ""
         if (currentDesc !== data.system.description.value) {
            patch["system.description.value"] = data.system.description.value
            changed = true
         }
         const flags = data.flags[MODULE_ID]
         for (const [key, value] of Object.entries(flags)) {
            if (existingItem.getFlag(MODULE_ID, key) !== value) {
               patch[`flags.${MODULE_ID}.${key}`] = value
               changed = true
            }
         }
         if (changed) updates.push(patch)
      }

      if (creates.length > 0)
         await vehicle.createEmbeddedDocuments("Item", creates, {
            siegeLoadSync: true,
         })
      if (updates.length > 0)
         await vehicle.updateEmbeddedDocuments("Item", updates, {
            siegeLoadSync: true,
         })
   }

   static _enteredCargoData(vehicle, actor) {
      const breakdown = this.enteredCargoBulk(vehicle, actor)
      const img = actor.prototypeToken?.texture?.src || actor.img
      const bulkLabel = formatBulk(breakdown.combined)
      return {
         name: tKey("VehicleLoad.EnteredCargoItem", {
            name: actor.name,
            bulk: bulkLabel,
         }),
         type: "equipment",
         img,
         system: {
            quantity: 1,
            description: {
               value: tKey("VehicleLoad.EnteredCargoDesc", {
                  name: actor.name,
                  vehicle: vehicle.name,
               }),
            },
            bulk: { value: breakdown.combined },
            size: "med",
         },
         flags: {
            [MODULE_ID]: {
               isEnteredCargoItem: true,
               enteredActorId: actor.id,
               enteredActorUuid: actor.uuid,
               rawBulk: breakdown.raw,
               intendedBulk: breakdown.wholeBulk,
               intendedLightCount: breakdown.lightCount,
            },
         },
      }
   }

   static enteredCargoBulk(vehicle, actor) {
      const threshold = this._lightThresholdBulk(vehicle)
      let rawTotal = 0
      let converted = 0
      const add = (rawBulk, quantity = 1) => {
         const raw = Number(rawBulk) || 0
         const qty = Math.max(0, Math.floor(Number(quantity) || 0))
         if (raw <= 0 || qty <= 0) return
         rawTotal += raw * qty
         converted += this._convertItemBulkForVehicle(raw, threshold) * qty
      }

      add(HaulManager.selfBulk(actor), 1)
      for (const item of HaulManager._physicalItems(actor)) {
         if (
            item.getFlag?.(MODULE_ID, "isHauledItem") ||
            item.getFlag?.(MODULE_ID, "isEnteredCargoItem")
         )
            continue
         add(this._itemUnitBulk(item), item.system?.quantity ?? item.quantity ?? 1)
      }

      const combined = this._round(converted)
      const tenths = Math.round(combined * 10)
      return {
         raw: this._round(rawTotal),
         combined,
         wholeBulk: Math.floor(tenths / 10),
         lightCount: tenths % 10,
      }
   }

   static _lightThresholdBulk(vehicle) {
      const size = vehicle?.system?.traits?.size?.value || "med"
      if (size === "lg" || size === "large") return 1
      if (size === "huge") return 2
      if (size === "grg" || size === "gargantuan") return 4
      return 0
   }

   static _convertItemBulkForVehicle(rawBulk, threshold) {
      const raw = Number(rawBulk) || 0
      if (threshold <= 0) return raw
      return Math.floor(raw / threshold) / 10
   }

   static _itemUnitBulk(item) {
      const raw = item?.system?.bulk?.value ?? item?.system?.bulk
      const parsed = this._parseBulkValue(raw)
      if (parsed !== null) return parsed

      const qty = Math.max(1, Number(item?.system?.quantity ?? item?.quantity) || 1)
      const bulk = HaulManager._perItemBulk(item)
      return (bulk.normal + bulk.light * 0.1) / qty
   }

   static _parseBulkValue(raw) {
      if (typeof raw === "number") return raw
      if (typeof raw === "string") {
         const value = raw.trim().toLowerCase()
         if (!value || value === "-" || value === "negligible") return 0
         if (value === "l" || value === "light") return 0.1
         const n = Number(value)
         return Number.isFinite(n) ? n : null
      }
      if (raw && typeof raw === "object") {
         if (raw.value !== undefined) return this._parseBulkValue(raw.value)
         const normal = Number(raw.normal)
         const light = Number(raw.light)
         if (Number.isFinite(normal) || Number.isFinite(light))
            return (Number.isFinite(normal) ? normal : 0) +
               (Number.isFinite(light) ? light : 0) * 0.1
      }
      return null
   }

   static _refreshVehicleHud(vehicle) {
      import("../ui/vehicle-hud.mjs")
         .then((m) => m.VehicleHUD?.refreshFor?.(vehicle.id))
         .catch(() => {})
   }

   static _round(value) {
      return Math.round((Number(value) || 0) * 10) / 10
   }
}
