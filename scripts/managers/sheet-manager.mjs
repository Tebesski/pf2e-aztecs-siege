import {
   MODULE_ID,
   DC_BY_LEVEL,
   DEFAULT_SIEGE_ACTION_FLAGS,
   ACTION_TEMPLATES,
   ATTACK_TEMPLATES,
   TRAIT_LORE_SKILLS,
   ENTERABLE_POSITIONS,
} from "../constants.mjs"
import { clampLevel, isSiege, slugify, tKey } from "../utils.mjs"
import { SiegeSheetUI } from "../ui/sheet-ui.mjs"
import { SiegePortableManager } from "./portable.mjs"
import { VehicleLoadManager } from "./vehicle-load.mjs"

export class SiegeWeaponManager {
   static initHooks() {
      Hooks.on("renderActorSheet", (app, html, data) =>
         SiegeSheetUI.renderSheet(app, html, data),
      )
      Hooks.on("updateActor", (actor, changes, options, userId) =>
         this.onUpdateActor(actor, changes, options, userId),
      )
      Hooks.on("preUpdateActor", (actor, changes) => {
         if (!isSiege(actor)) return

         const newLevel = foundry.utils.getProperty(
            changes,
            "system.details.level.value",
         )
         if (newLevel !== undefined && newLevel !== null) {
            foundry.utils.setProperty(
               changes,
               `flags.${MODULE_ID}.disableDC`,
               DC_BY_LEVEL[clampLevel(newLevel)],
            )
         }

const nextTraits = foundry.utils.getProperty(
            changes,
            "system.traits.value",
         )
         if (Array.isArray(nextTraits)) {
            const prev = actor.system.traits?.value || []
            const added = nextTraits.filter((t) => !prev.includes(t))
            let cleaned = nextTraits
            if (added.includes("portable"))
               cleaned = cleaned.filter((t) => t !== "mounted")
            else if (added.includes("mounted"))
               cleaned = cleaned.filter((t) => t !== "portable")
            else if (
               nextTraits.includes("mounted") &&
               nextTraits.includes("portable")
            )
               cleaned = cleaned.filter((t) => t !== "portable")
            if (cleaned.length !== nextTraits.length)
               foundry.utils.setProperty(
                  changes,
                  "system.traits.value",
                  cleaned,
               )
          }
       })
      Hooks.on("preUpdateItem", (item, changes) =>
         this._cleanActionItemTraitUpdate(item, changes),
      )
      Hooks.once("ready", async () => {
         if (!game.user.isGM) return
         for (const actor of game.actors.filter((a) => isSiege(a))) {
            await this._markCurrentTraitDefaultsApplied(actor)
            await this._cleanExistingActionItemTraits(actor)
            await this._ensureDefaultSiegeAction(actor, "repair")
         }
      })
   }

   static _cleanActionItemTraitUpdate(item, changes) {
      if (item?.type !== "action" || !isSiege(item.parent)) return
      const traits = foundry.utils.getProperty(changes, "system.traits.value")
      if (!Array.isArray(traits) || !traits.includes("siege-weapon")) return
      foundry.utils.setProperty(
         changes,
         "system.traits.value",
         traits.filter((t) => t !== "siege-weapon"),
      )
   }

   static async _cleanExistingActionItemTraits(actor) {
      const updates = actor.items
         .filter((item) => item.type === "action")
         .map((item) => {
            const traits = item.system?.traits?.value
            if (!Array.isArray(traits) || !traits.includes("siege-weapon"))
               return null
            return {
               _id: item.id,
               "system.traits.value": traits.filter((t) => t !== "siege-weapon"),
            }
         })
         .filter(Boolean)
      if (updates.length > 0)
         await actor.updateEmbeddedDocuments("Item", updates, {
            siegeTraitCleanup: true,
         })
   }

   static async onUpdateActor(actor, changes, options, userId) {
      if (game.user.id !== userId || actor.type !== "vehicle") return
      if (options?.siegeDefaultsSync) return

      if (
         foundry.utils.getProperty(changes, `flags.${MODULE_ID}.bulk`) !==
            undefined &&
         (actor.system.traits?.value || []).includes("portable")
      ) {
         await SiegePortableManager.syncPortableState(actor)
      }

      const traits = changes.system?.traits?.value
      if (traits && isSiege(actor)) {
         await this._clearEnterableIfPortable(actor, traits)
         await this._syncPortableTrait(actor, traits)
      }

      const isSiegeChanged = foundry.utils.getProperty(
         changes,
         `flags.${MODULE_ID}.isSiegeWeapon`,
      )
      if (isSiegeChanged === true) {
         await this._initializeSiegeWeapon(actor)
      }

const flagsTouched = foundry.utils.getProperty(changes, `flags.${MODULE_ID}`)
      if (
         flagsTouched &&
         ("enterable" in flagsTouched ||
            "drivable" in flagsTouched ||
            "rotatable" in flagsTouched)
      ) {
         await this._syncEnterableFeatures(actor)
      }

if (traits) {
         await this._applyNewTraitLoreDefaults(actor)
      }
   }

static async _clearEnterableIfPortable(actor, traits) {
      if (traits.includes("portable") && actor.getFlag(MODULE_ID, "enterable")) {
         await actor.update({
            [`flags.${MODULE_ID}.enterable`]: false,
            [`flags.${MODULE_ID}.drivable`]: false,
            [`flags.${MODULE_ID}.rotatable`]: false,
            [`flags.${MODULE_ID}.allowCrewTargeting`]: false,
         })
      }
   }

static async _syncEnterableFeatures(actor) {
      const enterable = !!actor.getFlag(MODULE_ID, "enterable")
      const drivable = enterable && !!actor.getFlag(MODULE_ID, "drivable")
      const rotatable =
         enterable && (drivable || !!actor.getFlag(MODULE_ID, "rotatable"))

      if (!enterable && actor.getFlag(MODULE_ID, "allowCrewTargeting"))
         await actor.setFlag(MODULE_ID, "allowCrewTargeting", false)

      if (enterable && VehicleLoadManager.rawLoadCapacity(actor) === null)
         await actor.setFlag(
            MODULE_ID,
            "loadCapacity",
            VehicleLoadManager.defaultLoadCapacity(actor),
         )

      const positions = [...(actor.getFlag(MODULE_ID, "crew") || [])]
      const driverTitle = ENTERABLE_POSITIONS.DRIVER
      const operatorTitle = ENTERABLE_POSITIONS.OPERATOR

      const hasDriver = positions.some((p) => p.title === driverTitle)
      const hasOperator = positions.some((p) => p.title === operatorTitle)

      let changed = false
      let next = positions

if (drivable && !hasDriver) {
         next.unshift({ title: driverTitle, min: 1, max: 1, icon: "" })
         changed = true
      }
      if (!drivable && hasDriver) {
         next = next.filter((p) => p.title !== driverTitle)
         changed = true
      }

const needsOperator = rotatable && !drivable
      if (needsOperator && !hasOperator) {
         next.unshift({ title: operatorTitle, min: 1, max: 1, icon: "" })
         changed = true
      }
      if (!needsOperator && hasOperator) {
         next = next.filter((p) => p.title !== operatorTitle)
         changed = true
      }

for (const p of next) {
         if (
            (p.title === driverTitle || p.title === operatorTitle) &&
            (!p.min || p.min < 1)
         ) {
            p.min = 1
            changed = true
         }
      }

      if (changed) await actor.setFlag(MODULE_ID, "crew", next)

      await this._syncDrivingManoeuvre(actor, drivable)
   }

   static async _syncDrivingManoeuvre(actor, drivable) {
      const tpl = ACTION_TEMPLATES.drivingManoeuvre
      const name = tKey(tpl.nameKey)
      const existing = actor.items.find(
         (i) => i.type === "action" && i.name === name,
      )
      if (drivable && !existing) {
         await actor.createEmbeddedDocuments("Item", [
            {
               name,
               type: "action",
               img: tpl.img || "icons/svg/aura.svg",
               system: {
                  description: { value: tKey(tpl.descKey) },
                  actionType: { value: "action" },
                  actions: { value: tpl.actionsCost || 1 },
               },
               flags: {
                  [MODULE_ID]: {
                     siegeAction: {
                        ...DEFAULT_SIEGE_ACTION_FLAGS,
                        skills: foundry.utils.deepClone(tpl.skills),
                        crewAccess: [ENTERABLE_POSITIONS.DRIVER],
                     },
                     isDrivingManoeuvre: true,
                  },
               },
            },
         ])
      } else if (!drivable && existing) {
         await actor.deleteEmbeddedDocuments("Item", [existing.id])
      }
   }

static async _applyNewTraitLoreDefaults(actor) {
      const applied = foundry.utils.deepClone(
         actor.getFlag(MODULE_ID, "defaultsApplied.traitLores") || {},
      )
      const wanted = this._wantedTraitLores(actor).filter(
         (lore) => !applied[this._traitDefaultKey(lore)],
      )
      if (wanted.length === 0) return

      const updates = []
      for (const item of actor.items.filter((i) => i.type === "action")) {
         const flag = item.getFlag(MODULE_ID, "siegeAction")
         if (!flag) continue
         const skills = foundry.utils.deepClone(flag.skills || [])
         const proficiencies = foundry.utils.deepClone(flag.proficiencies || [])
         const saveDCPaths = Array.isArray(flag.saveDCPaths)
            ? [...flag.saveDCPaths]
            : flag.saveDC != null && flag.saveDC !== ""
              ? [String(flag.saveDC)]
              : []
         let modified = false
         for (const lore of wanted) {
            const present = skills.some(
               (s) =>
                  s.name === "lore" &&
                  this._sameLoreName(s.loreName, lore.loreName),
            )
            if (!present) {
               skills.push({ ...lore })
               modified = true
            }
            const isStrikeAction = flag.isStrike || flag.isAttack
            const profPresent = proficiencies.some(
               (p) =>
                  p.name === "lore" &&
                  this._sameLoreName(p.loreName, lore.loreName),
            )
            if (isStrikeAction && !profPresent) {
               proficiencies.push({ name: "lore", loreName: lore.loreName })
               modified = true
            }
            const savePath = this._saveDcPathForLore(lore)
            const savePresent = saveDCPaths.some(
               (p) => String(p).trim() === savePath,
            )
            if (flag.isAttack && !flag.isStrike && !savePresent) {
               saveDCPaths.push(savePath)
               modified = true
            }
         }
         if (modified) {
            const update = {
               _id: item.id,
               [`flags.${MODULE_ID}.siegeAction.skills`]: skills,
            }
            if (flag.isStrike || flag.isAttack)
               update[`flags.${MODULE_ID}.siegeAction.proficiencies`] =
                  proficiencies
            if (flag.isAttack && !flag.isStrike)
               update[`flags.${MODULE_ID}.siegeAction.saveDCPaths`] =
                  saveDCPaths
            updates.push(update)
         }
      }
      if (updates.length > 0)
         await actor.updateEmbeddedDocuments("Item", updates)

      for (const lore of wanted) applied[this._traitDefaultKey(lore)] = true
      await actor.update(
         { [`flags.${MODULE_ID}.defaultsApplied.traitLores`]: applied },
         { siegeDefaultsSync: true },
      )
   }

   static async _markCurrentTraitDefaultsApplied(actor) {
      const applied = foundry.utils.deepClone(
         actor.getFlag(MODULE_ID, "defaultsApplied.traitLores") || {},
      )
      let changed = false
      for (const lore of this._wantedTraitLores(actor)) {
         const key = this._traitDefaultKey(lore)
         if (applied[key]) continue
         applied[key] = true
         changed = true
      }
      if (changed) {
         await actor.update(
            { [`flags.${MODULE_ID}.defaultsApplied.traitLores`]: applied },
            { siegeDefaultsSync: true },
         )
      }
   }

   static _wantedTraitLores(actor) {
      const traits = actor.system.traits?.value || []
      const wanted = []
      for (const [trait, lore] of Object.entries(TRAIT_LORE_SKILLS))
         if (traits.includes(trait)) wanted.push(lore)
      return wanted
   }

   static _traitDefaultKey(lore) {
      return slugify(lore?.loreName || lore?.trait || "")
   }

   static _saveDcPathForLore(lore) {
      return `@skills.${slugify(lore.loreName)}.dc.value`
   }

   static _sameLoreName(a, b) {
      const normalize = (value) => {
         const base = String(value || "").replace(/-lore$/i, "")
         return slugify(base)
      }
      return normalize(a) === normalize(b)
   }

   static async _syncPortableTrait(actor, traits) {
      if (traits.includes("portable")) {
         await SiegePortableManager.syncPortableState(actor)

         const toCreate = []
         const carryTpl = ACTION_TEMPLATES.carryInConcert
         const carryName = tKey(carryTpl.nameKey)
         const strikeTpl = ATTACK_TEMPLATES.strikeInConcert
         const strikeName = tKey(strikeTpl.nameKey)

         if (!actor.items.some((i) => i.name === carryName)) {
            toCreate.push({
               name: carryName,
               type: "action",
               img: carryTpl.img || "icons/svg/aura.svg",
               system: {
                  description: { value: tKey(carryTpl.descKey) },
                  actionType: { value: "action" },
                  actions: { value: carryTpl.actionsCost },
               },
               flags: {
                  [MODULE_ID]: {
                     siegeAction: { ...DEFAULT_SIEGE_ACTION_FLAGS },
                  },
               },
            })
         }

         if (!actor.items.some((i) => i.name === strikeName)) {
            toCreate.push({
               name: strikeName,
               type: "action",
               system: {
                  description: { value: tKey(strikeTpl.descKey) },
                  actionType: { value: "action" },
                  actions: { value: 1 },
               },
               flags: {
                  [MODULE_ID]: {
                     siegeAction: {
                        ...DEFAULT_SIEGE_ACTION_FLAGS,
                        isStrike: true,
                        usesAmmunition: false,
                        isRanged: false,
                        prerequisites: [{ name: "Lifted", count: 1 }],
                     },
                  },
               },
            })
         }

         if (toCreate.length > 0)
            await actor.createEmbeddedDocuments("Item", toCreate)
         return
      }
      await SiegePortableManager._clearPortableMarkers(actor)
   }

   static async _initializeSiegeWeapon(actor) {
      const currentTraits = actor.system.traits?.value || []
      if (!currentTraits.includes("mounted")) {
         await actor.update({
            "system.traits.value": [...currentTraits, "mounted"],
         })
      }
      if (VehicleLoadManager.rawLoadCapacity(actor) === null)
         await actor.setFlag(
            MODULE_ID,
            "loadCapacity",
            VehicleLoadManager.defaultLoadCapacity(actor),
         )

      const requiredActions = ["loading", "repair", "aiming", "moving"]
      const toCreate = []

      for (const key of requiredActions) {
         const tpl = ACTION_TEMPLATES[key]
         const name = tKey(tpl.nameKey)
         if (!actor.items.some((i) => i.type === "action" && i.name === name)) {
            toCreate.push({
               name: name,
               type: "action",
               img: tpl.img || "icons/svg/aura.svg",
               system: {
                  description: { value: tKey(tpl.descKey) },
                  actionType: { value: "action" },
                  actions: { value: tpl.actionsCost || 1 },
                  traits: { value: tpl.traits ? [tpl.traits] : [] },
               },
               flags: {
                  [MODULE_ID]: {
                     siegeAction: {
                        ...DEFAULT_SIEGE_ACTION_FLAGS,
                        ...(tpl.siegeAction || {}),
                        prerequisites: tpl.prereqs || [],
                        skills: foundry.utils.deepClone(tpl.skills || []),
                        actionType: tpl.actionType || "",
                     },
                  },
               },
            })
         }
      }

      if (toCreate.length > 0) {
         await actor.createEmbeddedDocuments("Item", toCreate)
      }
      await this._applyConversionActionDefaults(actor)
      ui.notifications.info(
         tKey("Notifications.ConvertedToSiege", { name: actor.name }),
      )
   }

   static async _ensureDefaultSiegeAction(actor, key) {
      const tpl = ACTION_TEMPLATES[key]
      if (!tpl) return
      const name = tKey(tpl.nameKey)
      if (actor.items.some((i) => i.type === "action" && i.name === name)) return
      await actor.createEmbeddedDocuments(
         "Item",
         [
            {
               name,
               type: "action",
               img: tpl.img || "icons/svg/aura.svg",
               system: {
                  description: { value: tKey(tpl.descKey) },
                  actionType: { value: "action" },
                  actions: { value: tpl.actionsCost || 1 },
                  traits: { value: tpl.traits ? [tpl.traits] : [] },
               },
               flags: {
                  [MODULE_ID]: {
                     siegeAction: {
                        ...DEFAULT_SIEGE_ACTION_FLAGS,
                        prerequisites: tpl.prereqs || [],
                        skills: foundry.utils.deepClone(tpl.skills || []),
                        actionType: tpl.actionType || "",
                     },
                  },
               },
            },
         ],
         { siegeDefaultsSync: true },
      )
   }

   static async _applyConversionActionDefaults(actor) {
      if (actor.getFlag(MODULE_ID, "defaultsApplied.conversionActionSkills"))
         return

      const wants = [
         {
            names: [tKey("ActionTemplates.Load.Name"), "Loading"],
            skill: { name: "athletics", loreName: "", dc: "" },
         },
         {
            names: [tKey("ActionTemplates.Aim.Name"), "Aiming"],
            skill: { name: "perception", loreName: "", dc: "" },
         },
      ]
      const updates = []

      for (const item of actor.items.filter((i) => i.type === "action")) {
         const match = wants.find((w) => w.names.includes(item.name))
         if (!match) continue
         const flag = item.getFlag(MODULE_ID, "siegeAction")
         if (!flag) continue
         const skills = foundry.utils.deepClone(flag.skills || [])
         if (skills.some((s) => s.name === match.skill.name)) continue
         skills.push({ ...match.skill })
         updates.push({
            _id: item.id,
            [`flags.${MODULE_ID}.siegeAction.skills`]: skills,
         })
      }

      if (updates.length > 0)
         await actor.updateEmbeddedDocuments("Item", updates)
      await actor.update(
         { [`flags.${MODULE_ID}.defaultsApplied.conversionActionSkills`]: true },
         { siegeDefaultsSync: true },
      )
   }
}
