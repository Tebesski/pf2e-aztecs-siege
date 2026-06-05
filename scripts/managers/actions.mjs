import {
   MODULE_ID,
   DEFAULT_SIEGE_ACTION_FLAGS,
   ACTION_TEMPLATES,
   ATTACK_TEMPLATES,
   TRAIT_LORE_SKILLS,
} from "../constants.mjs"
import { slugify, isSiege, tKey } from "../utils.mjs"
import { SiegeActionsUI } from "../ui/action-tab.mjs"
import { AmmoSiegeUI } from "../ui/ammo-tab.mjs"
import { VehicleHUD } from "../ui/vehicle-hud.mjs"
import { AmmunitionManager } from "./ammunition.mjs"

export class SiegeActionsManager {
   static initHooks() {
      Hooks.on("renderItemSheet", (app, html, data) => {
         const item = app.document
         if (AmmunitionManager.isAmmoItem(item)) {
            AmmoSiegeUI.renderSheetTab(app, html, data, item)
            return
         }
         if (!item.parent || !isSiege(item.parent)) return
         if (item.type !== "action") return
         SiegeActionsUI.renderSheetTab(app, html, data, item)
      })
      Hooks.on("updateItem", (item, changes) =>
         this._refreshWeaponryForActionUpdate(item, changes),
      )
   }

   static _refreshWeaponryForActionUpdate(item, changes) {
      if (item?.type !== "action" || !item.parent || !isSiege(item.parent))
         return
      const flagChanges =
         foundry.utils.getProperty(changes, `flags.${MODULE_ID}.siegeAction`) ||
         {}
      const touchesWeaponry = [
         "ammoSlug",
         "ammoSlugs",
         "maxLoaded",
         "spend",
         "usesAmmunition",
         "isAttack",
         "isStrike",
      ].some((key) => Object.prototype.hasOwnProperty.call(flagChanges, key))
      if (!touchesWeaponry) return
      item.parent.sheet?.render(false)
      VehicleHUD.refreshFor(item.parent.id)
   }

   static async showBuilderDialog(actor, isAttack) {
      const templates = isAttack ? ATTACK_TEMPLATES : ACTION_TEMPLATES
      const options = Object.entries(templates)
         .map(([k, v]) => `<option value="${k}">${tKey(v.nameKey)}</option>`)
         .join("")

      const titleKey = isAttack
         ? "Builder.CreateAttackTitle"
         : "Builder.CreateActionTitle"

      const choice = await foundry.applications.api.DialogV2.wait({
         classes: ["siege-v2-dialog"],
         window: { title: tKey(titleKey) },
         content: `<div class="form-group"><label>${tKey(
            "Builder.SelectTemplate",
         )}</label><select id="siege-template-select">${options}</select></div>`,
         buttons: [
            {
               action: "create",
               label: tKey("Builder.Create"),
               icon: "fa-solid fa-check",
               callback: () =>
                  document.getElementById("siege-template-select")?.value ??
                  null,
            },
         ],
      })

      if (!choice) return

      const tpl = templates[choice]
      const ammoTypes = actor.getFlag(MODULE_ID, "ammunitionTypes") || []
      const defaultAmmo =
         ammoTypes.length > 0
            ? slugify(ammoTypes[0].slug || ammoTypes[0].name)
            : ""
      const traitLores = this._traitLores(actor)
      const skills = foundry.utils.deepClone(tpl.skills || [])
      for (const lore of traitLores) {
         if (
            !skills.some(
               (s) =>
                  s.name === "lore" &&
                  this._sameLoreName(s.loreName, lore.loreName),
            )
         )
            skills.push({ ...lore })
      }
      const proficiencies = foundry.utils.deepClone(
         DEFAULT_SIEGE_ACTION_FLAGS.proficiencies,
      )
      if (isAttack) {
         for (const lore of traitLores) {
            if (
               !proficiencies.some(
                  (p) =>
                     p.name === "lore" &&
                     this._sameLoreName(p.loreName, lore.loreName),
               )
            )
               proficiencies.push({
                  name: "lore",
                  loreName: lore.loreName,
               })
         }
      }
      const saveDCPaths =
         isAttack && !tpl.isStrike
            ? traitLores.map(
                 (lore) => `@skills.${slugify(lore.loreName)}.dc.value`,
              )
            : []

      await actor.createEmbeddedDocuments("Item", [
         {
            name: tKey(tpl.nameKey),
            type: "action",
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
                      skills,
                     proficiencies,
                     saveDCPaths,
                     isAttack: isAttack,
                     isStrike: tpl.isStrike || false,
                     ammoSlug:
                        tpl.usesAmmunition === false
                           ? ""
                           : isAttack
                             ? defaultAmmo
                             : "",
                     ammoSlugs:
                        tpl.usesAmmunition === false || !isAttack || !defaultAmmo
                           ? []
                           : [defaultAmmo],
                     actionType: tpl.actionType || "",
                     usesAmmunition:
                        tpl.usesAmmunition !== undefined
                           ? tpl.usesAmmunition
                           : true,
                     isRanged: tpl.isRanged !== undefined ? tpl.isRanged : true,
                  },
               },
            },
         },
      ])
   }

   static _traitLores(actor) {
      const traits = actor.system.traits?.value || []
      const wanted = []
      for (const [trait, lore] of Object.entries(TRAIT_LORE_SKILLS))
         if (traits.includes(trait)) wanted.push(lore)
      return wanted
   }

   static _sameLoreName(a, b) {
      const normalize = (value) =>
         slugify(String(value || "").replace(/-lore$/i, ""))
      return normalize(a) === normalize(b)
   }
}
