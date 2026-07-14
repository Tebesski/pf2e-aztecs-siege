import { MODULE_ID } from "../../constants.mjs"
import { slugify, tKey } from "../../utils.mjs"
import { AmmunitionManager } from "../../managers/ammunition.mjs"
import { staticMethods } from "./helpers.mjs"

const DEFAULT_DAMAGE_PART = {
   dice: 1,
   die: "d6",
   type: "bludgeoning",
   category: "normal",
}

const DEFAULT_SHIELD_ENTRY = {
   type: "shield",
   name: "",
   img: "",
   acBonus: 2,
   hp: 20,
   hardness: 0,
   speedPenalty: 0,
}

const DEFAULT_LIGHT_ENTRY = {
   type: "light",
   name: "",
   img: "",
   light: {
      config: {
         dim: 10,
         bright: 5,
      },
   },
}

const DEFAULT_ACTION_ENTRY = {
   type: "action",
   actionKind: "strike",
   name: "",
   img: "",
   description: "",
   actions: 1,
   usesAmmunition: true,
   ammoSlugs: "",
   ammoTypes: [],
   maxLoaded: "",
   spend: 1,
   attackBonus: 0,
   rollOptions: "",
   traits: "",
   isRanged: true,
   blindRange: "",
   minRange: "",
   rangeIncrement: 120,
   maxRange: 600,
   actionType: "area-fire",
   areaSize: 5,
   areaType: "burst",
   saveDCPaths: "",
   damageParts: [{ ...DEFAULT_DAMAGE_PART }],
}

class ModuleTabListenerMixin {

   static bindListeners(app, item, html, flags) {
      const saveFlags = async (render = false) => {
         this._captureOpen(item, html)
         await item.update(
            { [`flags.${MODULE_ID}.vehicleModule`]: flags },
            render ? {} : { render: false },
         )
      }
      const saveWithRender = async () => {
         this._captureOpen(item, html)
         this._captureScroll(app, html)
         await item.update({ [`flags.${MODULE_ID}.vehicleModule`]: flags })
      }
      const updateScalar = (target, field, el) => {
         if (el.type === "checkbox") target[field] = el.checked
         else if (el.type === "number") target[field] = el.value === "" ? "" : Number(el.value)
         else target[field] = el.value
      }

      html.find(".siege-module-acc").on("toggle", (e) => {
         const id = e.currentTarget.dataset.entryId || e.currentTarget.dataset.modId
         if (!id) return
         const open = this._openSet(item)
         if (e.currentTarget.open) open.add(id)
         else open.delete(id)
      })

      html.find("[data-module-path]").on("change", async (e) => {
         const el = e.currentTarget
         updateScalar(flags, el.dataset.modulePath, el)
         if (el.dataset.modulePath === "isModule" || el.dataset.modulePath === "moduleType")
            await saveWithRender()
         else await saveFlags()
      })

      html.find(".module-add-entry").on("click", async (e) => {
         e.preventDefault()
         const select = html.find(".module-add-entry-type")
         const selected = String(select.val() || "rule").split("|")
         const type = selected[0]
         const entry =
            type === "action"
               ? {
                    ...DEFAULT_ACTION_ENTRY,
                    id: this._id("entry"),
                    name: item.name,
                    img: item.img,
                    actionKind: selected[1] || "strike",
                 }
               : type === "shield"
                 ? {
                      ...DEFAULT_SHIELD_ENTRY,
                      id: this._id("entry"),
                      name: item.name,
                      img: item.img,
                   }
                 : type === "light"
                   ? {
                        ...foundry.utils.deepClone(DEFAULT_LIGHT_ENTRY),
                        id: this._id("entry"),
                        name: item.name,
                        img: item.img,
                     }
                 : this._normalizeEntry({ type, id: this._id("entry") })
         if (entry.type === "rule" && !entry.json) entry.json = '{ "key": "" }'
         flags.entries.push(entry)
         this._openSet(item).add(entry.id)
         await saveWithRender()
      })

      html.find(".module-remove-entry").on("click", async (e) => {
         e.preventDefault()
         const id = $(e.currentTarget).closest("[data-entry-id]").data("entryId")
         flags.entries = flags.entries.filter((entry) => entry.id !== id)
         this._openSet(item).delete(id)
         await saveWithRender()
      })

      html.find("[data-entry-field]").on("change", async (e) => {
         const row = $(e.currentTarget).closest("[data-entry-id]")
         const entry = flags.entries.find((x) => x.id === row.data("entryId"))
         if (!entry) return
         if (e.currentTarget.dataset.entryField === "json") {
            const validation = this._validateRuleJson(e.currentTarget.value)
            this._showRuleValidation(row, validation)
            if (!validation.ok) {
               ui.notifications.warn(validation.message)
               return
            }
         }
         updateScalar(entry, e.currentTarget.dataset.entryField, e.currentTarget)
         if (e.currentTarget.dataset.entryField === "actionKind") await saveWithRender()
         else await saveFlags()
      })

      html.find(".module-open-light-editor").on("click", async (e) => {
         e.preventDefault()
         const row = $(e.currentTarget).closest("[data-entry-id]")
         const entry = flags.entries.find((x) => x.id === row.data("entryId"))
         if (!entry || entry.type !== "light") return
         await this._openLightEditor(entry, saveWithRender)
      })

      html.find(".module-add-mod").on("click", async (e) => {
         e.preventDefault()
         const mod = this._normalizeModification({ id: this._id("mod") })
         flags.modifications.push(mod)
         this._openSet(item).add(mod.id)
         await saveWithRender()
      })

      html.find(".module-remove-mod").on("click", async (e) => {
         e.preventDefault()
         const id = $(e.currentTarget).closest("[data-mod-id]").data("modId")
         flags.modifications = flags.modifications.filter((mod) => mod.id !== id)
         this._openSet(item).delete(id)
         await saveWithRender()
      })

      html.find("[data-mod-field]").on("change", async (e) => {
         const row = $(e.currentTarget).closest("[data-mod-id]")
         const mod = flags.modifications.find((x) => x.id === row.data("modId"))
         if (!mod) return
         const field = e.currentTarget.dataset.modField
         if (field === "skillLoreName")
            mod.skillLoreName = this._normalizeLoreName(e.currentTarget.value)
         else updateScalar(mod, field, e.currentTarget)
         if (field === "skillName") {
            if (mod.skillName !== "lore") mod.skillLoreName = ""
            await saveWithRender()
         } else if (field === "modifyRange" || field === "isRanged" || field === "modifyArea") {
            await saveWithRender()
         } else await saveFlags()
      })

      html.find(".module-format-json").on("click", async (e) => {
         e.preventDefault()
         const row = $(e.currentTarget).closest("[data-entry-id]")
         const entry = flags.entries.find((x) => x.id === row.data("entryId"))
         const textarea = row.find('[data-entry-field="json"]').get(0)
         if (!entry || !textarea) return
         const validation = this._validateRuleJson(textarea.value)
         this._showRuleValidation(row, validation)
         if (!validation.ok) {
            ui.notifications.warn(validation.message)
            return
         }
         textarea.value = JSON.stringify(validation.value, null, 3)
         entry.json = textarea.value
         await saveFlags()
      })

      html.find(".module-validate-json").on("click", (e) => {
         e.preventDefault()
         const row = $(e.currentTarget).closest("[data-entry-id]")
         const textarea = row.find('[data-entry-field="json"]').get(0)
         if (!textarea) return
         const validation = this._validateRuleJson(textarea.value)
         this._showRuleValidation(row, validation)
         ui.notifications[validation.ok ? "info" : "warn"](validation.message)
      })

      html.find(".module-ammo-drop").each((_, el) => {
         el.addEventListener("dragover", (e) => {
            e.preventDefault()
            el.classList.add("dragover")
         })
         el.addEventListener("dragleave", () => el.classList.remove("dragover"))
         el.addEventListener("drop", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            el.classList.remove("dragover")
            const row = $(el).closest("[data-entry-id]")
            const entry = flags.entries.find((x) => x.id === row.data("entryId"))
            if (!entry) return
            const dropped = await this._resolveDroppedItem(this._readDropData(e))
            if (!dropped || !AmmunitionManager.isAmmoItem(dropped)) {
               ui.notifications.warn(tKey("Ammunition.NotAmmo"))
               return
            }
            const slug = slugify(dropped.system?.slug || dropped.slug || dropped.name)
            entry.ammoTypes = entry.ammoTypes || []
            if (!entry.ammoTypes.some((ammo) => slugify(ammo.slug || ammo.name) === slug))
               entry.ammoTypes.push({ name: dropped.name, slug, img: dropped.img || "" })
            entry.ammoSlugs = entry.ammoTypes.map((ammo) => ammo.slug).join(", ")
            await saveWithRender()
         })
      })

      html.find(".module-remove-ammo").on("click", async (e) => {
         e.preventDefault()
         const row = $(e.currentTarget).closest("[data-entry-id]")
         const entry = flags.entries.find((x) => x.id === row.data("entryId"))
         if (!entry) return
         const slug = slugify($(e.currentTarget).data("slug"))
         entry.ammoTypes = (entry.ammoTypes || []).filter((ammo) => slugify(ammo.slug || ammo.name) !== slug)
         entry.ammoSlugs = entry.ammoTypes.map((ammo) => ammo.slug).join(", ")
         await saveWithRender()
      })

      html.find(".module-add-damage").on("click", async (e) => {
         e.preventDefault()
         const host = $(e.currentTarget).closest("[data-entry-id], [data-mod-id]")
         const collection = host.data("entryId") ? flags.entries : flags.modifications
         const id = host.data("entryId") || host.data("modId")
         const target = collection.find((x) => x.id === id)
         if (!target) return
         target.damageParts = target.damageParts || []
         target.damageParts.push({ ...DEFAULT_DAMAGE_PART })
         await saveWithRender()
      })

      html.find(".module-remove-damage").on("click", async (e) => {
         e.preventDefault()
         const host = $(e.currentTarget).closest("[data-entry-id], [data-mod-id]")
         const collection = host.data("entryId") ? flags.entries : flags.modifications
         const id = host.data("entryId") || host.data("modId")
         const target = collection.find((x) => x.id === id)
         if (!target) return
         const index = Number($(e.currentTarget).closest("[data-damage-index]").data("damageIndex"))
         target.damageParts.splice(index, 1)
         if (target.type === "action" && target.damageParts.length === 0)
            target.damageParts.push({ ...DEFAULT_DAMAGE_PART })
         await saveWithRender()
      })

      html.find(".module-dp-dice, .module-dp-die, .module-dp-type, .module-dp-category").on("change", async (e) => {
         const host = $(e.currentTarget).closest("[data-entry-id], [data-mod-id]")
         const collection = host.data("entryId") ? flags.entries : flags.modifications
         const id = host.data("entryId") || host.data("modId")
         const target = collection.find((x) => x.id === id)
         if (!target) return
         const row = $(e.currentTarget).closest("[data-damage-index]")
         const index = Number(row.data("damageIndex"))
         target.damageParts[index] = {
            dice: parseInt(row.find(".module-dp-dice").val()) || 0,
            die: row.find(".module-dp-die").val(),
            type: row.find(".module-dp-type").val(),
            category: row.find(".module-dp-category").val(),
         }
         await saveFlags()
      })
   }



   static async _openLightEditor(entry, saveWithRender) {
      const scene = canvas?.scene
      if (!scene) {
         ui.notifications.warn(tKey("Light.NoScene"))
         return
      }

      const existing = this._normalizeLightData(entry.light)
      const scratchData = foundry.utils.mergeObject(
         {
            x: -1000000,
            y: -1000000,
            hidden: true,
            config: { dim: 10, bright: 5 },
         },
         existing,
         { overwrite: false, recursive: true },
      )
      scratchData.x = -1000000
      scratchData.y = -1000000
      scratchData.hidden = true
      foundry.utils.setProperty(scratchData, `flags.${MODULE_ID}.isScratchLight`, true)
      delete scratchData._id

      let scratch
      try {
         ;[scratch] = await scene.createEmbeddedDocuments("AmbientLight", [scratchData])
      } catch (err) {
         ui.notifications.warn(tKey("Light.EditorFailed"))
         return
      }
      if (!scratch) return

      await new Promise((resolve) => {
         let resolved = false
         const matches = (app) =>
            app?.document?.id === scratch.id || app?.object?.id === scratch.id
         const finish = async () => {
            if (resolved) return
            resolved = true
            Hooks.off("closeAmbientLightConfig", closeHookId)
            Hooks.off("closeApplicationV2", closeV2HookId)

            try {
               const fresh = scene.lights.get(scratch.id) ?? scratch
               const saved = fresh.toObject()
               delete saved._id
               delete saved.x
               delete saved.y
               delete saved.hidden
               if (saved.flags?.[MODULE_ID]?.isScratchLight) {
                  delete saved.flags[MODULE_ID].isScratchLight
                  if (Object.keys(saved.flags[MODULE_ID]).length === 0)
                     delete saved.flags[MODULE_ID]
                  if (Object.keys(saved.flags ?? {}).length === 0)
                     delete saved.flags
               }
               entry.light = this._normalizeLightData(saved)
               await saveWithRender()
            } catch (_err) {}

            try {
               if (scene.lights.get(scratch.id))
                  await scene.deleteEmbeddedDocuments("AmbientLight", [scratch.id])
            } catch (_err) {}

            resolve()
         }

         const closeHookId = Hooks.on("closeAmbientLightConfig", (app) => {
            if (matches(app)) finish()
         })
         const closeV2HookId = Hooks.on("closeApplicationV2", (app) => {
            if (matches(app)) finish()
         })

         try {
            scratch.sheet?.render(true)
         } catch (_err) {
            finish()
         }
      })
   }



   static _validateRuleJson(raw) {
      const text = String(raw || "").trim()
      if (!text) return { ok: false, message: tKey("Modules.RuleJsonEmpty") }
      let parsed
      try {
         parsed = JSON.parse(text)
      } catch (err) {
         return { ok: false, message: tKey("Modules.RuleJsonInvalid", { error: err.message }) }
      }
      const rules = Array.isArray(parsed) ? parsed : [parsed]
      if (!rules.length || rules.some((rule) => !rule || typeof rule !== "object" || Array.isArray(rule)))
         return { ok: false, message: tKey("Modules.RuleJsonObject") }
      if (rules.some((rule) => typeof rule.key !== "string"))
         return { ok: false, message: tKey("Modules.RuleJsonKey") }
      return { ok: true, message: tKey("Modules.RuleJsonValid"), value: parsed }
   }



   static _showRuleValidation(row, validation) {
      row.find(".module-rule-validation")
         .removeClass("valid invalid")
         .addClass(validation.ok ? "valid" : "invalid")
         .text(validation.message)
   }



   static _readDropData(event) {
      const helper = foundry.applications?.ux?.TextEditor?.implementation?.getDragEventData
      try {
         const data = helper?.(event)
         if (data) return data
      } catch {
         
      }
      const tryParse = (raw) => {
         if (!raw) return null
         try {
            return JSON.parse(raw)
         } catch {
            return null
         }
      }
      return (
         tryParse(event.dataTransfer.getData("application/json")) ||
         tryParse(event.dataTransfer.getData("text/json")) ||
         tryParse(event.dataTransfer.getData("text/plain"))
      )
   }



   static async _resolveDroppedItem(data) {
      if (!data || data.type !== "Item") return null
      if (data.uuid || data.documentUuid)
         return fromUuid(data.uuid || data.documentUuid)
      if (data.id) {
         const worldItem = game.items.get(data.id)
         if (worldItem) return worldItem
         const actor = data.actorId ? game.actors.get(data.actorId) : null
         if (actor) return actor.items.get(data.id) || null
      }
      return null
   }
}

export const moduleTabListenerMethods = staticMethods(ModuleTabListenerMixin)
