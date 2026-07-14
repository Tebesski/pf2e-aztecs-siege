import { MODULE_ID } from "../constants.mjs"
import { capitalize, slugify, tKey, validImg } from "../utils.mjs"
import { buildDamageTagsHtml } from "../macros/helpers.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"

const escapeHtml = (value) =>
   foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "")

const formatList = (values) =>
   values.filter((v) => v !== undefined && v !== null && `${v}` !== "").join(" / ")

const formatCSV = (value) =>
   String(value || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .join(", ")

function sourceForAmmo(vehicle, action, slug, preferredItem = null) {
   const target = slugify(slug)
   if (preferredItem) return preferredItem
   const loaded = action
      ? AmmunitionManager.getLoadedAmmoPiecesForSlug(vehicle, action, target)
      : []
   if (loaded[0]?.template) return loaded[0].template
   return AmmunitionManager._ammoItemsFor(vehicle, target)[0] || null
}

export function ammoSummaryForAction(vehicle, action, slug, preferredItem = null) {
   const target = slugify(slug)
   const type = AmmunitionManager.ammoTypeFor(vehicle, target)
   const source = sourceForAmmo(vehicle, action, target, preferredItem)
   const flags = AmmunitionManager.siegeAmmoFlagsFromData(source || {})
   const loaded = action
      ? AmmunitionManager.loadedInfoForAction(vehicle, action, target)
      : { loaded: 0, max: "-", display: `0 / - (${type?.name || target})` }
   return {
      slug: target,
      name: source?.name || type?.name || target || tKey("Ammunition.TypeUnassigned"),
      img: validImg(source?.img || type?.img, "icons/svg/target.svg"),
      type,
      source,
      flags,
      stash: AmmunitionManager.getAvailableLoadUnits(vehicle, target),
      loaded,
   }
}

export function ammoDetailHTML(vehicle, action, slug, options = {}) {
   const summary = ammoSummaryForAction(
      vehicle,
      action,
      slug,
      options.item || null,
   )
   const flags = summary.flags
   const damage = buildDamageTagsHtml(flags.damageParts || [])
   const rows = [[tKey("Weaponry.StashAmount"), summary.stash]]
   if (options.showLoaded !== false)
      rows.push([tKey("Weaponry.LoadedAmount"), summary.loaded.display])
   rows.push([
      tKey("AmmoTab.DamageInfluence"),
      flags.damageInfluence === "rewrite"
         ? tKey("AmmoTab.RewriteDamage")
         : tKey("AmmoTab.ModifyDamage"),
   ])

   const overrideRows = []
   const attackBonus = parseInt(flags.attackBonus) || 0
   if (attackBonus !== 0)
      overrideRows.push([
         tKey("ActionTab.StrikeAttackBonus"),
         attackBonus > 0 ? `+${attackBonus}` : String(attackBonus),
      ])
   if (flags.rollOptions || flags.rewriteRollOptions)
      overrideRows.push([
         tKey("ActionTab.RollOptions"),
         `${formatCSV(flags.rollOptions) || tKey("Misc.None")}${
            flags.rewriteRollOptions ? ` (${tKey("AmmoTab.Rewrite")})` : ""
         }`,
      ])
   if (flags.traits || flags.rewriteTraits)
      overrideRows.push([
         tKey("ActionTab.Traits"),
         `${formatCSV(flags.traits) || tKey("Misc.None")}${
            flags.rewriteTraits ? ` (${tKey("AmmoTab.Rewrite")})` : ""
         }`,
      ])
   if (flags.material)
      overrideRows.push([
         tKey("AmmoTab.Material"),
         capitalize(String(flags.material).replace(/-/g, " ")),
      ])
   if (flags.modifyRange) {
      const rangeText = flags.isRanged === false
         ? tKey("Weaponry.NotRanged")
         : formatList([
              flags.blindRange
                 ? `${tKey("CrewHUD.RangeBlind")} ${flags.blindRange}`
                 : "",
              flags.minRange
                 ? `${tKey("CrewHUD.RangeMin")} ${flags.minRange}`
                 : "",
              flags.rangeIncrement
                 ? `${tKey("CrewHUD.RangeInc")} ${flags.rangeIncrement}`
                 : "",
              flags.maxRange
                 ? `${tKey("CrewHUD.RangeMax")} ${flags.maxRange}`
                 : "",
           ]) || tKey("Misc.None")
      overrideRows.push([tKey("CrewHUD.ActRange"), rangeText])
   } else {
      overrideRows.push([tKey("CrewHUD.ActRange"), tKey("Misc.None")])
   }

   if (flags.modifySaveDC) {
      overrideRows.push([
         tKey("ActionMacro.SaveDC"),
         (flags.saveDCPaths || []).length
            ? flags.saveDCPaths.map(escapeHtml).join(", ")
            : tKey("Misc.None"),
      ])
   } else {
      overrideRows.push([tKey("ActionMacro.SaveDC"), tKey("Misc.None")])
   }

   if (flags.modifyArea) {
      overrideRows.push([
         tKey("ActionMacro.Area"),
         `${flags.areaSize || 0} ft ${capitalize(flags.areaType || "")}`.trim(),
      ])
   } else {
      overrideRows.push([tKey("ActionMacro.Area"), tKey("Misc.None")])
   }

   return `
      <div class="siege-ammo-detail">
         <div class="siege-ammo-detail-head">
            <img class="siege-ammo-detail-icon" src="${summary.img}" alt="">
            <div>
               <div class="siege-ammo-detail-name">${escapeHtml(summary.name)}</div>
            </div>
         </div>
         <div class="siege-ammo-detail-grid">
            ${rows
               .map(
                  ([k, v]) =>
                     `<div class="siege-ammo-detail-row"><strong>${k}</strong><span>${v}</span></div>`,
               )
               .join("")}
         </div>
         <div class="siege-ammo-detail-section">
            <strong>${tKey("ActionMacro.Damage")}</strong>
            <div class="siege-damage-tags">${damage || tKey("Misc.None")}</div>
         </div>
         <div class="siege-ammo-detail-grid">
            ${overrideRows
               .map(
                  ([k, v]) =>
                     `<div class="siege-ammo-detail-row"><strong>${k}</strong><span>${v}</span></div>`,
               )
               .join("")}
         </div>
      </div>`
}

export function ammoTypesAccordionHTML(vehicle, action, options = {}) {
   const flag = action?.getFlag?.(MODULE_ID, "siegeAction") || {}
   const entries = AmmunitionManager.ammoSlugsForAction(flag)
   if (!entries.length) return `<p class="notes">${tKey("Ammunition.TypeUnassigned")}</p>`
   return `<div class="siege-actions-accordion siege-ammo-types-accordion">
      ${entries
         .map((slug) => {
            const summary = ammoSummaryForAction(vehicle, action, slug)
            return `<details class="siege-ammo-type-detail">
               <summary>
                  <div class="action-name">
                     <img src="${summary.img}" class="action-icon" />
                     <span>${escapeHtml(summary.name)}</span>
                  </div>
                  <i class="fa-solid fa-chevron-right chevron"></i>
               </summary>
               <div class="details-body">${ammoDetailHTML(vehicle, action, slug, options)}</div>
            </details>`
         })
         .join("")}
   </div>`
}
