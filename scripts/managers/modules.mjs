import {
   MODULE_ID,
   DEFAULT_SIEGE_ACTION_FLAGS,
} from "../constants.mjs"
import { isEnterableVehicle, isSiege, slugify, splitCSV, tKey } from "../utils.mjs"
import { ModuleItemUI } from "../ui/module-tab.mjs"
import { VehicleHUD } from "../ui/vehicle-hud.mjs"
import {
   VehicleShieldManager,
} from "./shields.mjs"
import { VehicleLightManager } from "./lights.mjs"
import {
   actionSlug,
   applyModification,
   cleanDisabledModuleIds,
   disabledModulesChanged,
} from "./modules/modification-utils.mjs"

export class VehicleModulesManager {
   static initHooks() {
      Hooks.on("renderItemSheet", (app, html, data) => {
         const item = app.document
         if (item?.type === "equipment") ModuleItemUI.renderSheetTab(app, html, data, item)
      })

      Hooks.once("ready", () => {
         if (!game.user.isGM) return
         for (const vehicle of game.actors.filter((actor) => actor.type === "vehicle"))
            this.queueSync(vehicle)
      })

      Hooks.on("createItem", (item, options = {}) => this._onItemChanged(item, options, {}))
      Hooks.on("updateItem", (item, changes, options = {}) =>
         this._onItemChanged(item, options, changes),
      )
      Hooks.on("deleteItem", (item, options = {}) => this._onItemChanged(item, options, {}))
      Hooks.on("updateActor", (actor, changes, options = {}) => {
         if (!game.user.isGM || options.siegeModuleSync || actor?.type !== "vehicle") return
         if (changes.name !== undefined || disabledModulesChanged(changes))
            this.queueSync(actor)
      })
   }

   static _onItemChanged(item, options = {}, changes = {}) {
      if (!game.user.isGM || options.siegeModuleSync) return
      const actor = item?.parent
      if (actor?.type !== "vehicle") return
      if (
         item.type === "shield" &&
         item.getFlag?.(MODULE_ID, "moduleGenerated")?.kind === "shield"
      ) {
         VehicleShieldManager.syncShieldItemHp(actor, item, changes).catch(() => {})
      }
      if (
         item.type === "equipment" ||
         item.type === "action" ||
         item.type === "shield" ||
         item.getFlag?.(MODULE_ID, "moduleGenerated")
      )
         this.queueSync(actor)
   }

   static queueSync(vehicle) {
      if (!vehicle?.id) return
      this._syncTimers = this._syncTimers || new Map()
      clearTimeout(this._syncTimers.get(vehicle.id))
      this._syncTimers.set(
         vehicle.id,
         setTimeout(() => {
            this._syncTimers.delete(vehicle.id)
            this.syncVehicle(vehicle).catch(() => {})
         }, 80),
      )
   }

   static isModuleItem(item) {
      return item?.type === "equipment" && item.getFlag?.(MODULE_ID, "vehicleModule")?.isModule === true
   }

   static normalizeBoard(raw = {}) {
      const clampPercent = (value) => {
         const number = Number(value)
         return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 50
      }
      const normalizeImageLayer = (layer = {}) => ({
         src: layer?.src || "",
         size: layer?.size || "cover",
         x: clampPercent(layer?.x ?? 50),
         y: clampPercent(layer?.y ?? 50),
      })
      const clampSlotSize = (value) => {
         const number = Number(value)
         return Number.isFinite(number) ? Math.max(24, Math.min(180, Math.round(number))) : 100
      }
      const layeredImages = Number(raw.imageLayersVersion) >= 2 || !!raw.foreground
      return {
         imageLayersVersion: 2,
         slots: Array.isArray(raw.slots) ? raw.slots.map((slot) => ({
            id: slot.id || foundry.utils.randomID(),
            kind: slot.kind === "component" ? "component" : "vehicle",
            moduleType: slot.moduleType || "",
            x: Number(slot.x) || 0,
            y: Number(slot.y) || 0,
            parentSlotId: slot.parentSlotId || "",
            installedItemId: slot.installedItemId || "",
         })) : [],
         actionPositions: raw.actionPositions && typeof raw.actionPositions === "object"
            ? raw.actionPositions
            : {},
         nodes: Array.isArray(raw.nodes) ? raw.nodes.map((node) => ({
            id: node.id || foundry.utils.randomID(),
            parentId: node.parentId || "",
            x: Number(node.x) || 0,
            y: Number(node.y) || 0,
         })).filter((node) => node.parentId) : [],
         slotSize: clampSlotSize(raw.slotSize),
         background: normalizeImageLayer(layeredImages ? raw.background : {}),
         foreground: normalizeImageLayer(layeredImages ? raw.foreground : raw.background),
      }
   }

   static moduleBoard(vehicle) {
      return this.normalizeBoard(vehicle?.getFlag?.(MODULE_ID, "moduleBoard") || {})
   }

   static installedModuleIds(vehicle) {
      return new Set(
         this.moduleBoard(vehicle).slots
            .map((slot) => slot.installedItemId)
            .filter(Boolean),
      )
   }

   static installedModules(vehicle) {
      if (!vehicle?.items) return []
      const installed = this.installedModuleIds(vehicle)
      return vehicle.items.filter(
         (item) => this.isModuleItem(item) && installed.has(item.id),
      )
   }

   static installedModuleData(vehicle) {
      if (!vehicle?.items) return []
      const disabled = this.disabledModuleIds(vehicle)
      return this.moduleBoard(vehicle).slots
         .map((slot) => {
            if (!slot.installedItemId) return null
            const item = vehicle.items.get(slot.installedItemId)
            if (!this.isModuleItem(item)) return null
            const flags = ModuleItemUI.normalizeFlags(
               item.getFlag(MODULE_ID, "vehicleModule") || {},
            )
            const applies = this._appliesToVehicle(vehicle, flags)
            return {
               id: item.id,
               uuid: item.uuid,
               name: item.name,
               img: item.img,
               slotId: slot.id,
               slotKind: slot.kind,
               moduleType: flags.moduleType,
               installType: flags.installType,
               disabled: disabled.has(item.id),
               active: applies && !disabled.has(item.id),
               applies,
            }
         })
         .filter(Boolean)
   }

   static disabledModuleIds(vehicle, source = "") {
      const grouped = this.normalizeDisabledModules(
         vehicle?.getFlag?.(MODULE_ID, "disabledModules") || {},
      )
      if (source) return new Set(grouped[source] || [])
      return new Set(Object.values(grouped).flat())
   }

   static normalizeDisabledModules(raw = {}) {
      if (Array.isArray(raw)) {
         const legacy = cleanDisabledModuleIds(raw)
         return legacy.length ? { legacy } : {}
      }
      if (!raw || typeof raw !== "object") return {}
      return Object.fromEntries(
         Object.entries(raw)
            .map(([source, ids]) => [
               String(source || "").trim(),
               cleanDisabledModuleIds(ids),
            ])
            .filter(([source, ids]) => source && ids.length),
      )
   }

   static async setDisabledModuleIds(vehicle, ids = [], { source = "ripAndTear", sync = true } = {}) {
      if (vehicle?.type !== "vehicle") return {}
      const sourceKey = String(source || "ripAndTear").trim() || "ripAndTear"
      const current = this.normalizeDisabledModules(
         vehicle.getFlag(MODULE_ID, "disabledModules") || {},
      )
      const next = foundry.utils.deepClone(current)
      const cleanIds = cleanDisabledModuleIds(ids)
      if (cleanIds.length) next[sourceKey] = cleanIds
      else delete next[sourceKey]

      if (JSON.stringify(current) === JSON.stringify(next)) {
         if (sync && game.user.isGM) this.queueSync(vehicle)
         return next
      }

      if (Object.keys(next).length) await vehicle.setFlag(MODULE_ID, "disabledModules", next)
      else await vehicle.unsetFlag(MODULE_ID, "disabledModules")

      if (sync && game.user.isGM) this.queueSync(vehicle)
      return next
   }

   static async clearDisabledModuleIds(vehicle, options = {}) {
      return this.setDisabledModuleIds(vehicle, [], options)
   }

   static activeModules(vehicle) {
      const installed = this.installedModuleIds(vehicle)
      const disabled = this.disabledModuleIds(vehicle)
      return vehicle.items.filter((item) => {
         if (!this.isModuleItem(item)) return false
         if (!installed.has(item.id)) return false
         if (disabled.has(item.id)) return false
         const flags = ModuleItemUI.normalizeFlags(item.getFlag(MODULE_ID, "vehicleModule") || {})
         return this._appliesToVehicle(vehicle, flags)
      })
   }

   static displayModules(vehicle) {
      const installed = this.installedModuleIds(vehicle)
      return vehicle.items.filter((item) => {
         if (!this.isModuleItem(item)) return false
         if (!installed.has(item.id)) return false
         const flags = ModuleItemUI.normalizeFlags(item.getFlag(MODULE_ID, "vehicleModule") || {})
         return this._appliesToVehicle(vehicle, flags)
      })
   }

   static moduleInstallType(item) {
      const flags = ModuleItemUI.normalizeFlags(item?.getFlag?.(MODULE_ID, "vehicleModule") || {})
      return flags.installType || ""
   }

   static isEligibleForSlot(vehicle, item, slot) {
      if (!this.isModuleItem(item)) return false
      const flags = ModuleItemUI.normalizeFlags(item.getFlag(MODULE_ID, "vehicleModule") || {})
      if (slot.kind === "component" && flags.moduleType !== "component") return false
      if (slot.kind !== "component" && flags.moduleType !== "vehicle") return false
      if (slot.moduleType && flags.installType && flags.installType !== slot.moduleType) return false
      return this._appliesToVehicle(vehicle, flags)
   }

   static moduleBonuses(vehicle) {
      return vehicle?.getFlag?.(MODULE_ID, "moduleBonuses") || {}
   }

   static loadCapacityBonus(vehicle) {
      return Number(this.moduleBonuses(vehicle).loadCapacity) || 0
   }

   static speedBonus(vehicle) {
      return Number(this.moduleBonuses(vehicle).speed) || 0
   }

   static saveBonus(vehicle, save) {
      const saves = this.moduleBonuses(vehicle).saves || {}
      return Number(saves?.[save]) || 0
   }

   static async syncVehicle(vehicle) {
      if (!game.user.isGM || vehicle?.type !== "vehicle") return
      const modules = this.activeModules(vehicle)
      const displayModules = this.displayModules(vehicle)
      const disabledModuleIds = this.disabledModuleIds(vehicle)
      await this._syncStatBonuses(vehicle, modules)
      await this._syncModuleAmmoTypes(vehicle, modules)
      await this._syncGeneratedItems(vehicle, displayModules, { disabledModuleIds })
      await this._syncComponentModifications(vehicle, modules)
      vehicle.sheet?.render(false)
      VehicleHUD.refreshFor(vehicle.id)
   }

   static _appliesToVehicle(vehicle, flags) {
      const names = splitCSV(flags.vehicleNames)
      return names.length === 0 || names.some((pattern) => this._wildcardMatch(pattern, vehicle.name))
   }

   static _wildcardMatch(pattern, value) {
      const source = String(pattern || "").trim()
      if (!source) return false
      const text = String(value || "")
      const escaped = source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
      return new RegExp(`^${escaped}$`, "i").test(text)
   }

   static _sourceKey(moduleItem, entryId) {
      return `${moduleItem.id}:${entryId}`
   }

   static _generatedFlag(sourceKey, moduleItem, entry, kind) {
      return {
         kind,
         sourceKey,
         moduleItemId: moduleItem.id,
         moduleItemUuid: moduleItem.uuid,
         entryId: entry.id,
      }
   }

   static async _syncStatBonuses(vehicle, modules) {
      const bonuses = {
         loadCapacity: 0,
         speed: 0,
         saves: { reflex: 0, will: 0, fortitude: 0 },
      }
      for (const moduleItem of modules) {
         const flags = ModuleItemUI.normalizeFlags(moduleItem.getFlag(MODULE_ID, "vehicleModule") || {})
         if (flags.moduleType === "vehicle") {
            for (const entry of flags.entries) {
               if (entry.type === "loadCapacity") bonuses.loadCapacity += Number(entry.value) || 0
               if (entry.type === "speed") bonuses.speed += Number(entry.value) || 0
               if (entry.type === "save") {
                  const save = entry.save || "reflex"
                  bonuses.saves[save] = (bonuses.saves[save] || 0) + (Number(entry.value) || 0)
               }
            }
            continue
         }
         for (const mod of flags.modifications)
            bonuses.loadCapacity += Number(mod.loadCapacityDelta) || 0
      }
      const currentRaw = vehicle.getFlag(MODULE_ID, "moduleBonuses")
      if (
         !currentRaw &&
         vehicle.getFlag(MODULE_ID, "moduleBaseSpeed") === undefined &&
         bonuses.loadCapacity === 0 &&
         bonuses.speed === 0 &&
         Object.values(bonuses.saves).every((v) => !v)
      )
         return
      const current = currentRaw || {}
      if (JSON.stringify(current) !== JSON.stringify(bonuses)) {
         await vehicle.setFlag(MODULE_ID, "moduleBonuses", bonuses, { siegeModuleSync: true })
      }
      await this._syncSpeedBonus(vehicle, Number(current.speed) || 0, bonuses.speed)
   }

   static async _syncSpeedBonus(vehicle, previousBonus = 0, nextBonus = 0) {
      if (previousBonus === 0 && nextBonus === 0 && vehicle.getFlag(MODULE_ID, "moduleBaseSpeed") === undefined)
         return
      const storedBase = vehicle.getFlag(MODULE_ID, "moduleBaseSpeed")
      const loadPrevious = vehicle.getFlag(MODULE_ID, "loadPreviousSpeed")
      const clampedByLoad = loadPrevious !== undefined
      const currentEffective = clampedByLoad
         ? Number(loadPrevious)
         : Number(vehicle.system?.details?.speed)
      if (!Number.isFinite(currentEffective)) return

      const base = storedBase !== undefined
         ? Number(storedBase)
         : currentEffective - previousBonus
      if (!Number.isFinite(base)) return

      const nextSpeed = Math.max(0, base + (Number(nextBonus) || 0))
      const update = {}
      if (nextBonus !== 0 && storedBase === undefined)
         update[`flags.${MODULE_ID}.moduleBaseSpeed`] = base
      if (clampedByLoad) update[`flags.${MODULE_ID}.loadPreviousSpeed`] = nextSpeed
      else update["system.details.speed"] = nextSpeed

      const shouldClearBase = nextBonus === 0 && storedBase !== undefined
      if (Object.keys(update).length > 0)
         await vehicle.update(update, { siegeModuleSync: true })
      if (shouldClearBase)
         await vehicle.unsetFlag(MODULE_ID, "moduleBaseSpeed")
   }

   static async _syncModuleAmmoTypes(vehicle, modules) {
      const current = foundry.utils.deepClone(
         vehicle.getFlag(MODULE_ID, "ammunitionTypes") || [],
      )
      const seen = new Set(current.map((type) => slugify(type.slug || type.name)))
      let changed = false
      for (const moduleItem of modules) {
         const flags = ModuleItemUI.normalizeFlags(moduleItem.getFlag(MODULE_ID, "vehicleModule") || {})
         if (flags.moduleType !== "vehicle") continue
         for (const entry of flags.entries) {
            if (entry.type !== "action") continue
            const ammoTypes = Array.isArray(entry.ammoTypes) && entry.ammoTypes.length
               ? entry.ammoTypes
               : splitCSV(entry.ammoSlugs).map((slug) => ({ name: slug, slug, img: "" }))
            for (const ammo of ammoTypes) {
               const slug = slugify(ammo.slug || ammo.name)
               if (!slug || seen.has(slug)) continue
               current.push({
                  name: ammo.name || ammo.slug || slug,
                  slug,
                  img: ammo.img || "",
               })
               seen.add(slug)
               changed = true
            }
         }
      }
      if (changed)
         await vehicle.setFlag(MODULE_ID, "ammunitionTypes", current, { siegeModuleSync: true })
   }

   static async _syncGeneratedItems(vehicle, modules, { disabledModuleIds = null } = {}) {
      const shieldStates = await VehicleShieldManager.syncShieldStates(
         vehicle,
         modules,
      )
      const desiredActions = new Map()
      const desiredEffects = new Map()
      const desiredShields = new Map()
      const desiredLightSourceKeys = new Set()
      const disabled = disabledModuleIds || this.disabledModuleIds(vehicle)
      const deletedShieldActions = vehicle.getFlag(MODULE_ID, "deletedGeneratedShieldActions") || {}

      for (const moduleItem of modules) {
         const flags = ModuleItemUI.normalizeFlags(moduleItem.getFlag(MODULE_ID, "vehicleModule") || {})
         if (flags.moduleType !== "vehicle") continue
         const moduleDisabled = disabled.has(moduleItem.id)
         const rules = []
         for (const entry of flags.entries) {
            if (entry.type === "action") {
               const sourceKey = this._sourceKey(moduleItem, entry.id)
               desiredActions.set(
                  sourceKey,
                  this._withActionDisabledState(
                     this._actionData(vehicle, moduleItem, entry, sourceKey),
                     moduleDisabled,
                  ),
               )
            } else if (entry.type === "shield") {
               const sourceKey = this._sourceKey(moduleItem, entry.id)
               const state =
                  shieldStates[sourceKey] ||
                  VehicleShieldManager.buildShieldState(moduleItem, entry, sourceKey)
               if (!deletedShieldActions[sourceKey])
                  desiredActions.set(
                     sourceKey,
                     this._withActionDisabledState(
                        VehicleShieldManager.shieldActionData(
                           vehicle,
                           moduleItem,
                           entry,
                           sourceKey,
                           state,
                        ),
                        moduleDisabled,
                     ),
                  )
               if (!moduleDisabled) {
                  desiredShields.set(
                     sourceKey,
                     VehicleShieldManager.shieldItemData(
                        vehicle,
                        moduleItem,
                        entry,
                        sourceKey,
                        state,
                     ),
                  )
               }
            } else if (entry.type === "light") {
               const sourceKey = this._sourceKey(moduleItem, entry.id)
               if (!moduleDisabled) desiredLightSourceKeys.add(sourceKey)
               desiredActions.set(
                  sourceKey,
                  this._withActionDisabledState(
                     VehicleLightManager.lightActionData(
                        vehicle,
                        moduleItem,
                        entry,
                        sourceKey,
                     ),
                     moduleDisabled,
                  ),
               )
            } else if (entry.type === "rule") {
               if (!moduleDisabled) rules.push(...this._parseRuleElement(entry.json))
            }
         }
         if (!moduleDisabled && rules.length > 0) {
            const entry = { id: "rules" }
            const sourceKey = this._sourceKey(moduleItem, entry.id)
            desiredEffects.set(sourceKey, this._effectData(moduleItem, entry, rules, sourceKey))
         }
      }

      const generated = vehicle.items.filter((item) => item.getFlag(MODULE_ID, "moduleGenerated"))
      const toDelete = generated
         .filter((item) => {
            const flag = item.getFlag(MODULE_ID, "moduleGenerated")
            if (flag.kind === "action") return !desiredActions.has(flag.sourceKey)
            if (flag.kind === "effect") return !desiredEffects.has(flag.sourceKey)
            if (flag.kind === "shield") return !desiredShields.has(flag.sourceKey)
            return true
         })
         .map((item) => item.id)
      if (toDelete.length)
         await vehicle.deleteEmbeddedDocuments("Item", toDelete, { siegeModuleSync: true })

      await VehicleLightManager.cleanupInactiveEffects(vehicle, desiredLightSourceKeys)

      await this._upsertGenerated(vehicle, "action", desiredActions)
      await this._upsertGenerated(vehicle, "effect", desiredEffects)
      await this._upsertGenerated(vehicle, "shield", desiredShields)

      const shieldItemMap = new Map(
         vehicle.items
            .filter((item) => item.getFlag(MODULE_ID, "moduleGenerated")?.kind === "shield")
            .map((item) => [
               item.getFlag(MODULE_ID, "moduleGenerated").sourceKey,
               item,
            ]),
      )
      const shieldActionMap = new Map(
         vehicle.items
            .filter(
               (item) =>
                  item.getFlag(MODULE_ID, "moduleGenerated")?.kind === "action" &&
                  item.getFlag(MODULE_ID, "siegeAction")?.isShieldActivate,
            )
            .map((item) => [
               item.getFlag(MODULE_ID, "moduleGenerated").sourceKey,
               item,
            ]),
      )
      await VehicleShieldManager.syncGeneratedLinks(
         vehicle,
         shieldItemMap,
         shieldActionMap,
      )
   }

   static _withActionDisabledState(data, disabled) {
      const siegeFlags = data.flags?.[MODULE_ID]?.siegeAction
      if (!siegeFlags) return data
      if (disabled) {
         siegeFlags.disabled = true
         siegeFlags.disabledByModule = true
         siegeFlags.disabledReason = "Disabled by vehicle damage."
      } else {
         siegeFlags.disabled = false
         siegeFlags.disabledByModule = false
         siegeFlags.disabledReason = ""
      }
      return data
   }

   static _parseRuleElement(raw) {
      const text = String(raw || "").trim()
      if (!text) return []
      try {
         const parsed = JSON.parse(text)
         return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed]
      } catch (err) {
         return []
      }
   }

   static _actionData(vehicle, moduleItem, entry, sourceKey) {
      const name = entry.name || moduleItem.name
      const flags = ModuleItemUI.actionFlagFromEntry({ ...entry, name })
      flags.strikeLabel = name
      return {
         name,
         type: "action",
         img: entry.img || moduleItem.img,
         system: {
            description: { value: entry.description || "" },
            actionType: { value: "action" },
            actions: { value: Number(entry.actions) || 1 },
            traits: { value: splitCSV(entry.traits) },
            slug: slugify(name),
         },
         flags: {
            [MODULE_ID]: {
               siegeAction: flags,
               moduleGenerated: this._generatedFlag(sourceKey, moduleItem, entry, "action"),
            },
         },
      }
   }

   static _effectData(moduleItem, entry, rules, sourceKey) {
      return {
         name: tKey("Modules.GeneratedRulesName", { name: moduleItem.name }),
         type: "effect",
         img: moduleItem.img,
         system: {
            level: { value: 1 },
            duration: {
               value: -1,
               unit: "unlimited",
               sustained: false,
               expiry: null,
            },
            tokenIcon: { show: false },
            description: { value: "" },
            rules,
         },
         flags: {
            [MODULE_ID]: {
               moduleGenerated: this._generatedFlag(sourceKey, moduleItem, entry, "effect"),
            },
         },
      }
   }

   static async _upsertGenerated(vehicle, kind, desired) {
      const existing = new Map(
         vehicle.items
            .filter((item) => item.getFlag(MODULE_ID, "moduleGenerated")?.kind === kind)
            .map((item) => [item.getFlag(MODULE_ID, "moduleGenerated").sourceKey, item]),
      )
      const creates = []
      const updates = []
      for (const [sourceKey, data] of desired) {
         const item = existing.get(sourceKey)
         if (!item) {
            creates.push(data)
            continue
         }
         updates.push(this._updateData(item, data))
      }
      if (creates.length)
         await vehicle.createEmbeddedDocuments("Item", creates, { siegeModuleSync: true })
      if (updates.length)
         await vehicle.updateEmbeddedDocuments("Item", updates, { siegeModuleSync: true })
   }

   static _updateData(item, data) {
      const update = {
         _id: item.id,
         name: data.name,
         img: data.img,
         [`flags.${MODULE_ID}.moduleGenerated`]: data.flags[MODULE_ID].moduleGenerated,
      }
      if (data.type === "action") {
         update["system.description.value"] = data.system.description.value
         update["system.actionType.value"] = data.system.actionType.value
         update["system.actions.value"] = data.system.actions.value
         update["system.traits.value"] = data.system.traits.value
         update["system.slug"] = data.system.slug
         update[`flags.${MODULE_ID}.siegeAction`] = data.flags[MODULE_ID].siegeAction
      } else if (data.type === "shield") {
         update["system.description.value"] = data.system.description.value
         update["system.acBonus"] = data.system.acBonus
         update["system.hardness"] = data.system.hardness
         update["system.speedPenalty"] = data.system.speedPenalty
         update["system.hp.value"] = data.system.hp.value
         update["system.hp.max"] = data.system.hp.max
         update["system.equipped"] = data.system.equipped
      } else {
         update["system.duration"] = data.system.duration
         update["system.tokenIcon"] = data.system.tokenIcon
         update["system.description.value"] = data.system.description.value
         update["system.rules"] = data.system.rules
      }
      return update
   }

   static async _syncComponentModifications(vehicle, modules) {
      const mods = []
      for (const moduleItem of modules) {
         const flags = ModuleItemUI.normalizeFlags(moduleItem.getFlag(MODULE_ID, "vehicleModule") || {})
         if (flags.moduleType !== "component") continue
         mods.push(...flags.modifications.filter((mod) => slugify(mod.targetSlug)))
      }

      const actions = vehicle.items.filter((item) => item.type === "action")
      const bySlug = new Map(actions.map((action) => [actionSlug(action), action]))
      const modsByAction = new Map()
      for (const mod of mods) {
         const action = bySlug.get(slugify(mod.targetSlug))
         if (!action) continue
         if (!modsByAction.has(action.id)) modsByAction.set(action.id, [])
         modsByAction.get(action.id).push(mod)
      }

      const updates = []
      const deletion = foundry.data?.operators?.ForcedDeletion
      for (const action of actions) {
         const base = action.getFlag(MODULE_ID, "moduleBaseSiegeAction")
         const actionMods = modsByAction.get(action.id) || []
         if (!base && actionMods.length === 0) continue
         if (actionMods.length === 0) {
            const update = {
               _id: action.id,
               [`flags.${MODULE_ID}.siegeAction`]: foundry.utils.deepClone(base),
            }
            if (deletion) update[`flags.${MODULE_ID}.moduleBaseSiegeAction`] = deletion
            updates.push(update)
            continue
         }

         const baseFlag = foundry.utils.deepClone(
            base || action.getFlag(MODULE_ID, "siegeAction") || DEFAULT_SIEGE_ACTION_FLAGS,
         )
         const next = foundry.utils.deepClone(baseFlag)
         for (const mod of actionMods) applyModification(next, mod)
         updates.push({
            _id: action.id,
            [`flags.${MODULE_ID}.siegeAction`]: next,
            [`flags.${MODULE_ID}.moduleBaseSiegeAction`]: baseFlag,
         })
      }
      if (updates.length)
         await vehicle.updateEmbeddedDocuments("Item", updates, { siegeModuleSync: true })
   }
   static isTrackedVehicle(actor) {
      return actor?.type === "vehicle" && (isSiege(actor) || isEnterableVehicle(actor) || this.installedModules(actor).length > 0)
   }
}
