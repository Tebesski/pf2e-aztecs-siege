import { MODULE_ID } from "../../constants.mjs"
import { slugify, splitCSV, tKey, validImg } from "../../utils.mjs"
import { ammoDetailHTML } from "../ammo-details.mjs"
import { AmmunitionManager } from "../../managers/ammunition.mjs"
import { escapeHTML, capitalizeForHud } from "./helpers.mjs"

class VehicleHUDStashMixin {
   _formatStashMetaValue(value) {
      if (value === undefined || value === null || value === "")
         return tKey("Misc.None")
      if (Array.isArray(value))
         return value.length ? value.map((v) => escapeHTML(v)).join(", ") : tKey("Misc.None")
      if (typeof value === "object") {
         if (value.value !== undefined) return this._formatStashMetaValue(value.value)
         const entries = Object.entries(value).filter(
            ([, v]) => v !== undefined && v !== null && v !== "" && Number(v) !== 0,
         )
         if (!entries.length) return tKey("Misc.None")
         return entries
            .map(([k, v]) => `${escapeHTML(v)} ${escapeHTML(k)}`)
            .join(", ")
      }
      return escapeHTML(value)
   }

   _formatStashBulk(value) {
      if (value === undefined || value === null || value === "")
         return "-"
      if (typeof value === "object") {
         if (value.value !== undefined) return this._formatStashBulk(value.value)
         if (value.normal !== undefined) return this._formatStashBulk(value.normal)
      }
      const text = String(value).trim()
      if (!text) return "-"
      if (/^(?:l|light)$/i.test(text)) return "L"
      if (/^(?:-|negligible|neg)$/i.test(text)) return "-"
      const numeric = Number(text)
      if (Number.isFinite(numeric)) {
         if (numeric <= 0) return "-"
         if (Math.abs(numeric - 0.1) < 0.0001) return "L"
      }
      return escapeHTML(text)
   }

   _rarityLabel(rarity) {
      const slug = String(rarity || "").trim()
      if (!slug) return tKey("Misc.None")
      return (
         game.i18n.localize(CONFIG.PF2E?.rarityTraits?.[slug] || "") ||
         capitalizeForHud(slug)
      )
   }

   _traitLabel(trait) {
      const slug = String(trait || "").trim()
      if (!slug) return ""
      const localized =
         CONFIG.PF2E?.itemTraits?.[slug] ||
         CONFIG.PF2E?.actionTraits?.[slug] ||
         CONFIG.PF2E?.weaponTraits?.[slug]
      return game.i18n.localize(localized || "") || capitalizeForHud(slug)
   }

   _signedStashNumber(value, suffix = "") {
      const number = Number(value) || 0
      const sign = number > 0 ? "+" : ""
      return `${sign}${number}${suffix}`
   }

   _moduleHumanName(value) {
      return (
         String(value || "")
            .trim()
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase()) || tKey("Misc.None")
      )
   }

   _moduleWildcardMatch(pattern, value) {
      const source = String(pattern || "").trim()
      if (!source) return false
      const escaped = source
         .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
         .replace(/\*/g, ".*")
      return new RegExp(`^${escaped}$`, "i").test(String(value || ""))
   }

   _moduleVehicleModelLabels(flags) {
      const names = splitCSV(flags.vehicleNames)
      if (!names.length) return [tKey("Modules.AllVehicleModels")]
      const vehicles = game.actors?.filter?.((actor) => actor.type === "vehicle") || []
      const labels = []
      for (const name of names) {
         if (name.includes("*")) {
            const matches = vehicles
               .filter((actor) => this._moduleWildcardMatch(name, actor.name))
               .map((actor) => actor.name)
            labels.push(...(matches.length ? matches : [this._moduleHumanName(name.replace(/\*/g, ""))]))
         } else {
            labels.push(name)
         }
      }
      return [...new Set(labels.map((label) => String(label || "").trim()).filter(Boolean))]
   }

   _moduleActionSlug(action) {
      return slugify(action?.system?.slug || action?.slug || action?.name)
   }

   _moduleTargetActions(targetSlug) {
      const target = slugify(targetSlug)
      if (!target) return []
      return this.vehicle.items.filter(
         (action) => action.type === "action" && this._moduleActionSlug(action) === target,
      )
   }

   _moduleTargetBadgesHTML(targetSlug) {
      const actions = this._moduleTargetActions(targetSlug)
      if (!actions.length)
         return `<span class="vh-module-target-fallback">${escapeHTML(this._moduleHumanName(targetSlug || tKey("Modules.UnassignedType")))}</span>`
      return actions
         .map(
            (action) =>
               `<button type="button" class="vh-module-target-badge" data-action-id="${escapeHTML(action.id)}">${escapeHTML(action.name)}</button>`,
         )
         .join("")
   }

   _moduleCleanDeltaLabel(label) {
      return String(label || "")
         .replace(/\s*\+\/-\s*/g, "")
         .trim()
   }

   _moduleValuePart(label, value, suffix = "") {
      if (!Number(value)) return ""
      return `<span><strong>${escapeHTML(this._moduleCleanDeltaLabel(label))}:</strong> ${escapeHTML(this._signedStashNumber(value, suffix))}</span>`
   }

   _moduleTextPart(label, value) {
      const text = String(value || "").trim()
      if (!text) return ""
      return `<span><strong>${escapeHTML(label)}:</strong> ${escapeHTML(text)}</span>`
   }

   _moduleDamageFormula(parts) {
      return (Array.isArray(parts) ? parts : [])
         .map((part) => {
            const dice = Number(part.dice) || 0
            const die = String(part.die || "").trim()
            const base = die === "-" ? String(dice) : `${dice || ""}${die}`.trim()
            const type = part.type ? ` ${this._moduleHumanName(part.type).toLowerCase()}` : ""
            const category =
               part.category && part.category !== "normal"
                  ? ` (${this._moduleHumanName(part.category).toLowerCase()})`
                  : ""
            return `${base}${type}${category}`.trim()
         })
         .filter(Boolean)
         .join(", ")
   }

   _moduleRangeText(mod) {
      if (!mod.modifyRange) return ""
      if (mod.isRanged === false) return tKey("Weaponry.Melee")
      const parts = []
      if (mod.blindRange) parts.push(`${tKey("CrewHUD.RangeBlind")} ${mod.blindRange}`)
      if (mod.minRange) parts.push(`${tKey("CrewHUD.RangeMin")} ${mod.minRange}`)
      if (mod.rangeIncrement) parts.push(`${tKey("CrewHUD.RangeInc")} ${mod.rangeIncrement}`)
      if (mod.maxRange) parts.push(`${tKey("CrewHUD.RangeMax")} ${mod.maxRange}`)
      return parts.length ? `${parts.join(" / ")} ft.` : tKey("Weaponry.NotRanged")
   }

   _moduleAreaText(mod) {
      if (!mod.modifyArea) return ""
      return `${mod.areaSize || 5} ft ${mod.areaType || "burst"}`
   }

   _moduleMetaLine(label, value) {
      return `<div class="vh-module-meta-line"><strong>${escapeHTML(label)}:</strong><span>${value}</span></div>`
   }

   _moduleItemDetailsHTML(item, { open = false } = {}) {
      const flags = item.getFlag?.(MODULE_ID, "vehicleModule") || {}
      if (flags.isModule !== true) return ""

      const moduleType =
         flags.moduleType === "component"
            ? tKey("Modules.ComponentModule")
            : tKey("Modules.VehicleModule")
      const vehicleModels = this._moduleVehicleModelLabels(flags)
      const metaRows = [
         `<div class="vh-module-meta-kind">${escapeHTML(moduleType)}</div>`,
         this._moduleMetaLine(
            tKey("Modules.ModuleType"),
            escapeHTML(flags.installType || tKey("Modules.UnassignedType")),
         ),
         this._moduleMetaLine(
            tKey("Modules.VehicleModels"),
            `<span class="vh-module-model-list">${vehicleModels
               .map((model) => escapeHTML(model))
               .join(", ")}</span>`,
         ),
      ]
      if (flags.craftingDC !== "" && flags.craftingDC !== undefined)
         metaRows.push(this._moduleMetaLine(tKey("Modules.CraftingDC"), escapeHTML(flags.craftingDC)))

      const effectRows = []

      for (const entry of flags.entries || []) {
         if (entry.type === "rule") {
            effectRows.push(
               `<div class="vh-module-effect-row"><strong>${tKey("Modules.AddsRuleElement")}</strong></div>`,
            )
         } else if (entry.type === "action") {
            effectRows.push(`<div class="vh-module-effect-row"><strong>${tKey("Modules.AddsLabel")}:</strong> <span>${escapeHTML(entry.name || item.name)}</span></div>`)
         } else if (entry.type === "loadCapacity") {
            const part = this._moduleValuePart(tKey("Modules.LoadCapacity"), entry.value)
            if (part) effectRows.push(`<div class="vh-module-effect-row vh-module-effect-parts">${part}</div>`)
         } else if (entry.type === "speed") {
            const part = this._moduleValuePart(tKey("Modules.Speed"), entry.value, " ft.")
            if (part) effectRows.push(`<div class="vh-module-effect-row vh-module-effect-parts">${part}</div>`)
         } else if (entry.type === "save") {
            const saveLabel =
               entry.save === "fortitude"
                  ? tKey("Attributes.Fortitude")
                  : entry.save === "will"
                    ? tKey("Attributes.Will")
                    : tKey("Attributes.Reflex")
            const part = this._moduleValuePart(saveLabel, entry.value)
            if (part) effectRows.push(`<div class="vh-module-effect-row vh-module-effect-parts">${part}</div>`)
         } else if (entry.type === "shield") {
            const name = escapeHTML(entry.name || item.name)
            effectRows.push(
               `<div class="vh-module-effect-row"><strong>${tKey("Modules.AddsLabel")}:</strong> <span>${name}</span></div>`,
            )
            const parts = [
               this._moduleValuePart(tKey("Modules.AcBonus"), entry.acBonus),
               this._moduleValuePart(tKey("Modules.HitPoints"), entry.hp),
               this._moduleValuePart(tKey("Modules.Hardness"), entry.hardness),
               this._moduleValuePart(tKey("Modules.SpeedPenalty"), entry.speedPenalty),
            ].filter(Boolean)
            if (parts.length)
               effectRows.push(
                  `<div class="vh-module-effect-row vh-module-effect-parts">${parts.join(" ")}</div>`,
               )
         } else if (entry.type === "light") {
            const name = escapeHTML(entry.name || item.name)
            const config = entry.light?.config || {}
            effectRows.push(
               `<div class="vh-module-effect-row"><strong>${tKey("Modules.AddsLabel")}:</strong> <span>${name}</span></div>`,
            )
            effectRows.push(
               `<div class="vh-module-effect-row vh-module-effect-parts">${this._moduleTextPart(
                  tKey("Modules.Light"),
                  tKey("Modules.LightSummary", {
                     dim: Math.max(0, Number(config.dim) || 0),
                     bright: Math.max(0, Number(config.bright) || 0),
                  }),
               )}</div>`,
            )
         }
      }

      for (const mod of flags.modifications || []) {
         const bits = []
         if (Number(mod.loadCapacityDelta))
            bits.push(this._moduleValuePart(tKey("Modules.LoadCapacity"), mod.loadCapacityDelta))
         if (Number(mod.attackBonusDelta))
            bits.push(this._moduleValuePart(tKey("Modules.AttackBonusDelta"), mod.attackBonusDelta))
         if (Number(mod.saveDCDelta))
            bits.push(this._moduleValuePart(tKey("Modules.SaveDCDelta"), mod.saveDCDelta))
         if (Number(mod.loadActionsRequiredDelta))
            bits.push(this._moduleValuePart(tKey("Modules.LoadActionsRequiredDelta"), mod.loadActionsRequiredDelta))
         if (Number(mod.maxLoadedDelta))
            bits.push(this._moduleValuePart(tKey("Modules.MaxLoadedDelta"), mod.maxLoadedDelta))
         if (Number(mod.spendDelta))
            bits.push(this._moduleValuePart(tKey("Modules.SpendDelta"), mod.spendDelta))
         const rollOptions = splitCSV(mod.rollOptions).join(", ")
         if (rollOptions) bits.push(this._moduleTextPart(tKey("Modules.RollOptions"), rollOptions))
         const traits = splitCSV(mod.traits).map((trait) => this._traitLabel(trait)).filter(Boolean).join(", ")
         if (traits) bits.push(this._moduleTextPart(tKey("ActionTab.Traits"), traits))
         const rangeText = this._moduleRangeText(mod)
         if (rangeText) bits.push(this._moduleTextPart(tKey("CrewHUD.ActRange"), rangeText))
         const areaText = this._moduleAreaText(mod)
         if (areaText) bits.push(this._moduleTextPart(tKey("ActionMacro.Area"), areaText))
         if (mod.prerequisiteName)
            bits.push(
               this._moduleTextPart(
                  tKey("Modules.PrerequisiteName"),
                  `${mod.prerequisiteName} ${this._signedStashNumber(mod.prerequisiteDelta)}`,
               ),
            )
         if (mod.skillName)
            bits.push(
               this._moduleTextPart(
                  tKey("Modules.SkillName"),
                  `${mod.skillName === "lore" && mod.skillLoreName ? mod.skillLoreName : mod.skillName} ${this._signedStashNumber(mod.skillDCDelta)}`,
               ),
            )
         const damage = this._moduleDamageFormula(mod.damageParts)
         if (damage) bits.push(this._moduleTextPart(tKey("Modules.Damage"), damage))
         effectRows.push(
            `<div class="vh-module-effect-row">
               <div class="vh-module-mod-targets"><strong>${tKey("Modules.ModifiesLabel")}:</strong><span class="vh-module-targets">${this._moduleTargetBadgesHTML(mod.targetSlug)}</span></div>
               ${bits.length ? `<div class="vh-module-effect-parts">${bits.join("")}</div>` : ""}
            </div>`,
         )
      }

      if (!metaRows.length && !effectRows.length) return ""
      return `<details class="vh-stash-module-details" ${open ? "open" : ""}>
         <summary><i class="fa-solid fa-chevron-right vh-stash-module-caret"></i><i class="fa-solid fa-puzzle-piece"></i> ${tKey("Modules.ModuleDetails")}</summary>
         <div class="vh-stash-module-body">
            <div class="vh-stash-module-layout">
               <div class="vh-stash-module-meta">${metaRows.join("")}</div>
               <div class="vh-stash-module-effects">
                  ${effectRows.length ? effectRows.join("") : `<div class="vh-empty">${tKey("Modules.NoModuleEffects")}</div>`}
               </div>
            </div>
         </div>
      </details>`
   }

   async _inspectModule(item) {
      if (!item) return
      const qty = item.system?.quantity ?? 1
      const content = `<div class="siege-vehicle-hud vh-module-inspect">
         <div class="vh-stash-list">
            <div class="vh-stash-item vh-stash-accordion">
               <div class="vh-stash-head">
                  <img class="vh-stash-icon" src="${validImg(item.img, "icons/svg/item-bag.svg")}" alt="">
                  <div class="vh-stash-body">
                     <div class="vh-stash-name">${escapeHTML(item.name)}</div>
                  </div>
                  <span class="vh-stash-qty">x${qty}</span>
               </div>
               <div class="vh-stash-detail" style="display:block;">
                  ${this._stashItemDetailHTML(item, { openModuleDetails: true })}
               </div>
            </div>
         </div>
      </div>`
      await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog", "siege-module-inspect-dialog"],
         window: { title: item.name || tKey("Modules.ModuleDetails") },
         position: { width: 560 },
         content,
         buttons: [{ action: "close", label: tKey("Buttons.Close"), default: true }],
      }).catch(() => null)
   }

   _stashItemDetailHTML(item, { openModuleDetails = false } = {}) {
      const system = item.system || {}
      const qty = system.quantity ?? 1
      const bulk = system.bulk?.value ?? system.bulk?.normal ?? system.bulk
      const price = system.price?.value ?? system.price ?? ""
      const rarity =
         system.traits?.rarity ?? system.rarity?.value ?? system.rarity ?? ""
      const level = system.level?.value ?? system.level ?? ""
      const traits = Array.isArray(system.traits?.value)
         ? system.traits.value.map((t) => this._traitLabel(t)).filter(Boolean)
         : []
      const rawDescription =
         system.description?.value ||
         (typeof system.description === "string" ? system.description : "")
      const description =
         rawDescription || `<p class="vh-empty">${tKey("Stash.NoDescription")}</p>`
      const meta = [
         [tKey("Stash.Quantity"), qty],
         [tKey("Stash.Bulk"), this._formatStashBulk(bulk)],
         [tKey("Stash.Price"), price],
         [tKey("Stash.Rarity"), this._rarityLabel(rarity)],
         [tKey("Stash.Level"), level],
         [tKey("Stash.Traits"), traits],
      ]
      const ammo = AmmunitionManager.isAmmoItem(item)
         ? ammoDetailHTML(
              this.vehicle,
              null,
              item.system?.slug || slugify(item.name),
              { item, showLoaded: false },
           )
         : ""
      const moduleDetails = this._moduleItemDetailsHTML(item, { open: openModuleDetails })
      return `<div class="vh-stash-detail-inner">
         <div class="vh-stash-description">
            <div>${description}</div>
         </div>
         ${moduleDetails}
         <div class="vh-stash-meta-grid">
            ${meta
               .map(
                  ([k, v]) =>
                     `<div class="vh-stash-meta-row"><strong>${k}</strong><span>${this._formatStashMetaValue(v)}</span></div>`,
               )
               .join("")}
         </div>
         ${ammo ? `<div class="vh-stash-ammo-detail">${ammo}</div>` : ""}
      </div>`
   }

_tabStash() {
      const items = this.vehicle.items.filter(
         (i) =>
            !i.getFlag(MODULE_ID, "isEnteredCargoItem") &&
            ((i.isOfType && i.isOfType("physical")) ||
               ["weapon", "armor", "equipment", "consumable", "treasure", "backpack", "ammunition"].includes(
                  i.type,
               )),
      )
      if (items.length === 0)
         return `<div class="vh-stash vh-stash-drop"><p class="vh-empty">${tKey("Stash.Empty")}</p></div>`

const order = [
         "module",
         "shield",
         "ammunition",
         "weapon",
         "armor",
         "equipment",
         "consumable",
         "treasure",
         "backpack",
      ]
      const labelKey = {
         module: "Stash.CatModules",
         shield: "Shield.Shields",
         ammunition: "Stash.CatAmmunition",
         weapon: "Stash.CatWeapons",
         armor: "Stash.CatArmor",
         equipment: "Stash.CatEquipment",
         consumable: "Stash.CatConsumables",
         treasure: "Stash.CatTreasure",
         backpack: "Stash.CatContainers",
         other: "Stash.CatOther",
      }
      const buckets = {}
      for (const i of items) {
         const isGeneratedShield =
            i.type === "shield" ||
            i.getFlag(MODULE_ID, "moduleGenerated")?.kind === "shield"
         const cat = isGeneratedShield
            ? "shield"
            : i.getFlag(MODULE_ID, "vehicleModule")?.isModule
            ? "module"
            : AmmunitionManager.isAmmoItem(i)
            ? "ammunition"
            : order.includes(i.type)
              ? i.type
              : "other"
         ;(buckets[cat] = buckets[cat] || []).push(i)
      }

      const renderItem = (i) => {
         const qty = i.system?.quantity ?? 1
         const charge = AmmunitionManager._chargeInfo(i)
         const chargeText = charge.usesCharges
            ? ` (${charge.value}/${charge.max})`
            : ""
         return `<div class="vh-stash-item vh-stash-accordion" data-item-id="${i.id}" draggable="true">
            <div class="vh-stash-head" data-action="toggle-stash-item">
               <img class="vh-stash-icon" src="${validImg(i.img, "icons/svg/item-bag.svg")}" alt="">
               <div class="vh-stash-body">
                  <div class="vh-stash-name">${escapeHTML(i.name)}</div>
               </div>
               <span class="vh-stash-qty">x${qty}${chargeText}</span>
               <button class="vh-stash-take vh-stash-retrieve" type="button" data-item-id="${i.id}" data-tooltip="${tKey("Stash.RetrieveFromStash")}"><i class="fa-solid fa-arrow-up-from-bracket"></i></button>
               <button class="vh-stash-take vh-stash-remove" type="button" data-item-id="${i.id}" data-tooltip="${tKey("Stash.RemoveFromStash")}"><i class="fa-solid fa-trash"></i></button>
               <button class="vh-acc-toggle vh-stash-toggle" type="button"><i class="fa-solid fa-chevron-right"></i></button>
            </div>
            <div class="vh-stash-detail" style="display:none;">
               ${this._stashItemDetailHTML(i)}
            </div>
         </div>`
      }

      const catState = this._loadJSON("stashCategories", {})
      const sections = [...order, "other"]
         .filter((cat) => buckets[cat]?.length)
         .map(
            (cat) => `<details class="vh-stash-cat" data-cat="${cat}" ${catState[cat] === false ? "" : "open"}>
               <summary class="vh-stash-cat-head"><span><i class="fa-solid fa-chevron-${catState[cat] === false ? "right" : "down"} chevron"></i> ${tKey(labelKey[cat])}</span> <span class="vh-stash-cat-count">${buckets[cat].length}</span></summary>
               <div class="vh-stash-cat-items">${buckets[cat].map(renderItem).join("")}</div>
            </details>`,
         )
         .join("")

      return `<div class="vh-stash vh-stash-drop"><div class="vh-stash-list">${sections}</div></div>`
   }

}

export const vehicleHudStashMethods = Object.fromEntries(
   Object.getOwnPropertyNames(VehicleHUDStashMixin.prototype)
      .filter((name) => name !== "constructor")
      .map((name) => [name, VehicleHUDStashMixin.prototype[name]]),
)
