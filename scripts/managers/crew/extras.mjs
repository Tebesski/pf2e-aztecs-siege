import { MODULE_ID } from "../../constants.mjs"
import { capitalize, getCrewActors, slugify, tKey } from "../../utils.mjs"
import { SiegeSocketManager } from "../sockets.mjs"
import { staticMethods } from "./helpers.mjs"

const CREW_EXTRA_TYPES = new Set([
   "apply-condition",
   "apply-effect",
   "apply-rule-element",
])
const DEFAULT_CREW_EXTRA_RULE = '{\n  "key": "FlatModifier"\n}'
const VALUED_CONDITIONS = new Set([
   "clumsy",
   "doomed",
   "drained",
   "dying",
   "enfeebled",
   "frightened",
   "persistent-damage",
   "sickened",
   "slowed",
   "stunned",
   "stupefied",
   "wounded",
])

class CrewPositionExtrasMixin {

   static _defaultPositionExtra(type = "apply-condition") {
      const cleanType = CREW_EXTRA_TYPES.has(type) ? type : "apply-condition"
      return {
         id: foundry.utils.randomID(),
         type: cleanType,
         condition: "frightened",
         value: 1,
         effectUuid: "",
         ruleJson: DEFAULT_CREW_EXTRA_RULE,
         description: "",
      }
   }



   static _normalizePositionExtras(raw) {
      if (!Array.isArray(raw)) return []
      return raw
         .map((entry) => {
            const type = CREW_EXTRA_TYPES.has(entry?.type)
               ? entry.type
               : "apply-condition"
            return {
               ...this._defaultPositionExtra(type),
               id: String(entry?.id || foundry.utils.randomID()),
               type,
               condition: slugify(entry?.condition || "frightened"),
               value: Math.max(1, parseInt(entry?.value) || 1),
               effectUuid: String(entry?.effectUuid || entry?.uuid || "").trim(),
               ruleJson:
                  typeof entry?.ruleJson === "string"
                     ? entry.ruleJson
                     : entry?.rule
                       ? JSON.stringify(entry.rule, null, 2)
                       : DEFAULT_CREW_EXTRA_RULE,
               description: String(entry?.description || "").trim(),
            }
         })
         .filter((entry) => CREW_EXTRA_TYPES.has(entry.type))
   }



   static _positionExtras(position = {}) {
      return this._normalizePositionExtras(
         position.positionEffects || position.extraApplications || [],
      )
   }



   static _hasPositionExtras(position = {}) {
      return this._positionExtras(position).length > 0
   }



   static _dialogRoot(dialog = null, button = null) {
      return dialog?.element || button?.form || document
   }



   static _escapeHTML(value) {
      const text = String(value ?? "")
      return foundry.utils.escapeHTML?.(text) ?? text
   }



   static _positionEffectDuration() {
      return {
         value: -1,
         unit: "unlimited",
         sustained: false,
         expiry: null,
      }
   }



   static _conditionOptions(selected) {
      const configured = CONFIG?.PF2E?.conditionTypes || {}
      const selectedSlug = slugify(selected || "")
      const entries = Array.isArray(configured)
         ? configured.map((value) => [slugify(value), value])
         : Object.entries(configured).map(([key, value]) => {
              const rawValue =
                 typeof value === "string" &&
                 /^[a-z][a-z0-9-]*$/i.test(value) &&
                 !value.includes(".")
                    ? value
                    : key
              return [slugify(rawValue), value]
           })
      const fallback = [
         "blinded",
         "clumsy",
         "confused",
         "dazzled",
         "deafened",
         "doomed",
         "drained",
         "dying",
         "enfeebled",
         "fascinated",
         "fatigued",
         "frightened",
         "grabbed",
         "hidden",
         "immobilized",
         "off-guard",
         "paralyzed",
         "persistent-damage",
         "prone",
         "quickened",
         "sickened",
         "slowed",
         "stunned",
         "stupefied",
         "unconscious",
         "wounded",
      ].map((slug) => [slug, capitalize(slug.replace(/-/g, " "))])
      return (entries.length ? entries : fallback)
         .filter(([value]) => !!value && !/^\d+$/.test(value))
         .map(([value, label]) => {
            const doc = this._conditionDocument(value)
            const localized =
               typeof label === "string" ? game.i18n.localize(label) : ""
            return {
               value,
               label:
                  doc?.name ||
                  (localized && localized !== label
                     ? localized
                     : capitalize(value.replace(/-/g, " "))),
               selected: value === selectedSlug,
            }
         })
         .sort((a, b) => a.label.localeCompare(b.label))
   }



   static _conditionDocument(slug) {
      try {
         return game.pf2e?.ConditionManager?.getCondition?.(slugify(slug || "")) || null
      } catch (_err) {
         return null
      }
   }



   static _conditionHasValue(slug) {
      const cleanSlug = slugify(slug || "")
      const doc = this._conditionDocument(cleanSlug)
      const systemValue = doc?.system?.value
      if (systemValue?.isValued === true) return true
      if (
         systemValue?.value !== null &&
         systemValue?.value !== undefined &&
         Number.isFinite(Number(systemValue.value))
      )
         return true
      return VALUED_CONDITIONS.has(cleanSlug)
   }



   static _conditionIcon(slug) {
      return (
         this._conditionDocument(slug)?.img ||
         "systems/pf2e/icons/default-icons/condition.svg"
      )
   }



   static _renderPositionExtras(extras) {
      return `<hr class="siege-crew-extra-separator">
         <section class="siege-crew-extra-effects">
            <header class="siege-crew-extra-header">
               <h4>${tKey("Crew.PositionApplications")}</h4>
               <div class="siege-crew-extra-adds">
                  <button type="button" class="siege-crew-extra-add" data-type="apply-condition"><i class="fa-solid fa-plus"></i> ${tKey("ActionTab.ApplyCondition")}</button>
                  <button type="button" class="siege-crew-extra-add" data-type="apply-effect"><i class="fa-solid fa-plus"></i> ${tKey("ActionTab.ApplyEffect")}</button>
                  <button type="button" class="siege-crew-extra-add" data-type="apply-rule-element"><i class="fa-solid fa-plus"></i> ${tKey("ActionTab.ApplyRuleElement")}</button>
               </div>
            </header>
            <div class="siege-crew-extra-list">
               ${this._renderPositionExtraRows(extras)}
            </div>
         </section>`
   }



   static _renderPositionExtraRows(extras) {
      const normalized = this._normalizePositionExtras(extras)
      if (normalized.length === 0) return ""
      return normalized.map((entry) => this._renderPositionExtraRow(entry)).join("")
   }



   static _renderPositionExtraRow(entry) {
      const typeLabel = {
         "apply-condition": tKey("ActionTab.ApplyCondition"),
         "apply-effect": tKey("ActionTab.ApplyEffect"),
         "apply-rule-element": tKey("ActionTab.ApplyRuleElement"),
      }[entry.type]
      let body = ""
      if (entry.type === "apply-condition") {
         const options = this._conditionOptions(entry.condition)
            .map(
               (option) =>
                  `<option value="${this._escapeHTML(option.value)}" ${option.selected ? "selected" : ""}>${this._escapeHTML(option.label)}</option>`,
            )
            .join("")
         body = `<div class="siege-crew-extra-condition-row">
            <img class="siege-crew-extra-condition-icon" src="${this._escapeHTML(this._conditionIcon(entry.condition))}" alt="">
            <select class="siege-crew-extra-condition">${options}</select>
            <input type="number" class="siege-crew-extra-condition-value siege-input-tiny" value="${entry.value}" min="1" ${this._conditionHasValue(entry.condition) ? "" : 'style="display:none;"'}>
         </div>`
      } else if (entry.type === "apply-effect") {
         body = `<div class="siege-crew-extra-effect-row">
            <img class="siege-crew-extra-effect-icon" src="icons/svg/aura.svg" alt="">
            <input type="text" class="siege-crew-extra-effect-uuid" value="${this._escapeHTML(entry.effectUuid)}" placeholder="${tKey("ActionTab.UUID")}">
            <a class="siege-crew-extra-effect-link invalid">${tKey("ActionTab.NoEffectUUID")}</a>
         </div>`
      } else {
         body = `<div class="siege-crew-extra-rule-row">
            <textarea class="siege-crew-extra-rule-json" rows="4" placeholder="${tKey("ActionTab.RuleElement")}">${this._escapeHTML(entry.ruleJson)}</textarea>
            <span class="siege-crew-extra-rule-status invalid">${tKey("ActionTab.InvalidRuleElement")}</span>
         </div>`
      }
      const description = `<label class="siege-crew-extra-description-row">
         <span>${tKey("Crew.ExtraDescription")}</span>
         <textarea class="siege-crew-extra-description" rows="2" placeholder="${this._escapeHTML(tKey("Crew.ExtraDescriptionPlaceholder"))}">${this._escapeHTML(entry.description)}</textarea>
      </label>`
      return `<div class="siege-crew-extra-row" data-extra-id="${this._escapeHTML(entry.id)}" data-type="${this._escapeHTML(entry.type)}">
         <div class="siege-crew-extra-row-head">
            <strong>${typeLabel}</strong>
            <button type="button" class="siege-crew-extra-reapply">${tKey("Crew.Reapply")}</button>
            <a class="siege-crew-extra-remove" data-tooltip="${tKey("Buttons.Remove")}"><i class="fa-solid fa-trash"></i></a>
         </div>
         ${body}
         ${description}
      </div>`
   }



   static _collectPositionExtras(root) {
      this._formatAllPositionRuleJson(root)
      const rows = Array.from(root.querySelectorAll(".siege-crew-extra-row"))
      return this._normalizePositionExtras(
         rows.map((row) => ({
            id: row.dataset.extraId,
            type: row.dataset.type,
            condition: row.querySelector(".siege-crew-extra-condition")?.value,
            value: row.querySelector(".siege-crew-extra-condition-value")?.value,
            effectUuid: row.querySelector(".siege-crew-extra-effect-uuid")?.value,
            ruleJson: row.querySelector(".siege-crew-extra-rule-json")?.value,
            description: row.querySelector(".siege-crew-extra-description")?.value,
         })),
      )
   }



   static _validateRuleElementText(text) {
      try {
         const parsed = JSON.parse(text || "")
         if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
            return { valid: false, message: tKey("ActionTab.InvalidRuleElement") }
         if (typeof parsed.key !== "string" || parsed.key.trim() === "")
            return { valid: false, message: tKey("ActionTab.RuleElementMissingKey") }
         return { valid: true, message: tKey("ActionTab.ValidRuleElement") }
      } catch (_err) {
         return { valid: false, message: tKey("ActionTab.InvalidJSON") }
      }
   }



   static async _refreshPositionExtraValidation(root) {
      for (const row of root.querySelectorAll(".siege-crew-extra-row")) {
         const type = row.dataset.type
         if (type === "apply-condition") {
            const condition = row.querySelector(".siege-crew-extra-condition")?.value
            const icon = row.querySelector(".siege-crew-extra-condition-icon")
            if (icon) icon.src = this._conditionIcon(condition)
         } else if (type === "apply-effect") {
            const input = row.querySelector(".siege-crew-extra-effect-uuid")
            const icon = row.querySelector(".siege-crew-extra-effect-icon")
            const link = row.querySelector(".siege-crew-extra-effect-link")
            const uuid = String(input?.value || "").trim()
            if (!uuid) {
               if (icon) icon.src = "icons/svg/aura.svg"
               if (link) {
                  link.textContent = tKey("ActionTab.NoEffectUUID")
                  link.removeAttribute("data-uuid")
                  link.classList.remove("valid")
                  link.classList.add("invalid")
               }
               continue
            }
            const doc = await fromUuid(uuid).catch(() => null)
            const isEffect = doc?.documentName === "Item" && doc.type === "effect"
            if (icon) icon.src = isEffect ? doc.img || "icons/svg/aura.svg" : "icons/svg/hazard.svg"
            if (link) {
               link.textContent = isEffect ? doc.name : tKey("ActionTab.InvalidUUID")
               link.classList.toggle("valid", isEffect)
               link.classList.toggle("invalid", !isEffect)
               if (isEffect) link.dataset.uuid = uuid
               else link.removeAttribute("data-uuid")
            }
         } else if (type === "apply-rule-element") {
            const input = row.querySelector(".siege-crew-extra-rule-json")
            const status = row.querySelector(".siege-crew-extra-rule-status")
            const result = this._validateRuleElementText(input?.value)
            if (status) {
               status.textContent = result.message
               status.classList.toggle("valid", result.valid)
               status.classList.toggle("invalid", !result.valid)
            }
         }
      }
   }



   static async _effectFromDrop(event) {
      const transfer = event?.dataTransfer || event?.originalEvent?.dataTransfer
      if (!transfer) return null
      let data = null
      try {
         data = JSON.parse(transfer.getData("text/plain") || "{}")
      } catch (_err) {
         return null
      }
      const uuid =
         data.uuid ||
         (data.pack && data.id ? `Compendium.${data.pack}.Item.${data.id}` : null)
      const doc = uuid ? await fromUuid(uuid).catch(() => null) : null
      return doc?.documentName === "Item" && doc.type === "effect" ? doc : null
   }



   static _parseRuleElement(text) {
      const result = this._validateRuleElementText(text)
      if (!result.valid) return null
      return JSON.parse(text)
   }



   static _formatPositionRuleJson(input) {
      if (!input) return false
      const result = this._validateRuleElementText(input.value)
      if (!result.valid) return false
      try {
         input.value = JSON.stringify(JSON.parse(input.value), null, 3)
         return true
      } catch (_err) {
         return false
      }
   }



   static _formatAllPositionRuleJson(root) {
      root
         ?.querySelectorAll?.(".siege-crew-extra-rule-json")
         ?.forEach((input) => this._formatPositionRuleJson(input))
   }



   static _managedExtraItems(actor, vehicleId) {
      return (actor?.itemTypes?.effect || []).filter(
         (item) =>
            item.getFlag(MODULE_ID, "crewPositionExtra") &&
            item.getFlag(MODULE_ID, "crewPositionVehicleId") === vehicleId,
      )
   }



   static async removeCrewPositionExtras(crewman, vehicleOrId) {
      const vehicleId = typeof vehicleOrId === "string" ? vehicleOrId : vehicleOrId?.id
      if (!crewman || !vehicleId) return
      const ids = this._managedExtraItems(crewman, vehicleId).map((item) => item.id)
      if (ids.length === 0) return
      await SiegeSocketManager.modifySiegeItem(crewman.uuid, "delete", ids, {
         render: false,
         siegePositionExtra: true,
      })
   }



   static async syncCrewPositionExtras(crewman, vehicle, positionTitle = null) {
      if (!crewman || !vehicle) return
      await this.removeCrewPositionExtras(crewman, vehicle)
      const title =
         positionTitle ||
         crewman.itemTypes?.effect
            ?.find(
               (effect) =>
                  effect.getFlag(MODULE_ID, "siegeId") === vehicle.id &&
                  effect.getFlag(MODULE_ID, "position"),
            )
            ?.getFlag(MODULE_ID, "position")
      if (!title) return
      const position = (vehicle.getFlag(MODULE_ID, "crew") || []).find(
         (entry) => entry.title === title,
      )
      const extras = this._positionExtras(position)
      if (extras.length === 0) return
      const sources = []
      for (const extra of extras) {
         const source = await this._positionExtraSource(extra, vehicle, title, crewman)
         if (source) sources.push(source)
      }
      if (sources.length === 0) return
      await SiegeSocketManager.modifySiegeItem(crewman.uuid, "create", sources, {
         render: false,
         siegePositionExtra: true,
      })
   }



   static async reapplyPositionExtras(vehicle, positionTitle = null) {
      if (!vehicle) return
      for (const actor of getCrewActors(vehicle)) {
         const position = actor.itemTypes?.effect
            ?.find(
               (effect) =>
                  effect.getFlag(MODULE_ID, "siegeId") === vehicle.id &&
                  effect.getFlag(MODULE_ID, "position"),
            )
            ?.getFlag(MODULE_ID, "position")
         if (!position) continue
         if (positionTitle && position !== positionTitle) continue
         await this.syncCrewPositionExtras(actor, vehicle, position)
      }
   }



   static _extraFlags(extra, vehicle, position) {
      return {
         [MODULE_ID]: {
            crewPositionExtra: true,
            crewPositionVehicleId: vehicle.id,
            crewPositionVehicleUuid: vehicle.uuid,
            crewPosition: position,
            extraId: extra.id,
            extraType: extra.type,
         },
      }
   }



   static async _positionExtraSource(extra, vehicle, position, crewman) {
      if (extra.type === "apply-condition")
         return this._conditionExtraSource(extra, vehicle, position)
      if (extra.type === "apply-rule-element")
         return this._ruleExtraSource(extra, vehicle, position)
      if (extra.type !== "apply-effect") return null
      const effect = await fromUuid(extra.effectUuid).catch(() => null)
      if (effect?.documentName !== "Item" || effect.type !== "effect") return null
      const source = effect.toObject()
      delete source._id
      foundry.utils.setProperty(source, "system.duration", this._positionEffectDuration())
      const sourceFlags = foundry.utils.deepClone(source.flags || {})
      if (sourceFlags[MODULE_ID]) {
         for (const key of [
            "siegeId",
            "siegeUuid",
            "position",
            "isEntered",
            "isLiftingEffect",
            "isLiftedItem",
            "isPortableMarker",
         ])
            delete sourceFlags[MODULE_ID][key]
      }
      source.flags = foundry.utils.mergeObject(
         sourceFlags,
         this._extraFlags(extra, vehicle, position),
         { inplace: false },
      )
      const description = this._customExtraDescription(extra)
      if (description)
         foundry.utils.setProperty(source, "system.description.value", description)
      else if (!source.system?.description?.value)
         foundry.utils.setProperty(
            source,
            "system.description.value",
            this._defaultExtraDescription(vehicle, position),
         )
      foundry.utils.setProperty(source, "flags.core.sourceId", effect.uuid)
      foundry.utils.setProperty(source, "flags.pf2e.origin.uuid", vehicle.uuid)
      return source
   }



   static _customExtraDescription(extra) {
      return String(extra?.description || "").trim()
   }



   static _defaultExtraDescription(vehicle, position) {
      return tKey("Crew.PositionExtraDesc", {
         vehicle: vehicle.name,
         position,
      })
   }



   static _extraDescription(extra, vehicle, position) {
      return this._customExtraDescription(extra) || this._defaultExtraDescription(vehicle, position)
   }



   static _conditionExtraSource(extra, vehicle, position) {
      const condition = this._conditionDocument(extra.condition)
      if (!condition) return null
      const grant = {
         key: "GrantItem",
         uuid: condition.uuid || condition.sourceId,
      }
      if (this._conditionHasValue(extra.condition)) {
         grant.alterations = [
            {
               mode: "override",
               property: "system.value.value",
               value: Math.max(1, parseInt(extra.value) || 1),
            },
         ]
      }
      return {
         name: tKey("Crew.PositionConditionName", {
            name: condition.name || capitalize(extra.condition),
         }),
         type: "effect",
         img: condition.img || "systems/pf2e/icons/default-icons/condition.svg",
         system: {
            level: { value: 1 },
            duration: this._positionEffectDuration(),
            tokenIcon: { show: true },
            description: {
               value: this._extraDescription(extra, vehicle, position),
            },
            rules: [grant],
         },
         flags: this._extraFlags(extra, vehicle, position),
      }
   }



   static _ruleExtraSource(extra, vehicle, position) {
      const rule = this._parseRuleElement(extra.ruleJson)
      if (!rule) return null
      return {
         name: tKey("Crew.PositionRuleElementName", { position }),
         type: "effect",
         img: "icons/svg/aura.svg",
         system: {
            level: { value: 1 },
            duration: this._positionEffectDuration(),
            tokenIcon: { show: true },
            description: {
               value: this._extraDescription(extra, vehicle, position),
            },
            rules: [rule],
         },
         flags: this._extraFlags(extra, vehicle, position),
      }
   }
}

export const crewPositionExtraMethods = staticMethods(CrewPositionExtrasMixin)
