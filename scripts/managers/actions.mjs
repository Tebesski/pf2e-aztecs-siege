import {
   MODULE_ID,
   DEFAULT_SIEGE_ACTION_FLAGS,
   ACTION_TEMPLATES,
   ATTACK_TEMPLATES,
} from "../constants.mjs"
import { slugify, isSiege, tKey } from "../utils.mjs"
import { SiegeActionsUI } from "../ui/action-tab.mjs"

export class SiegeActionsManager {
   static initHooks() {
      Hooks.on("renderItemSheet", (app, html, data) => {
         const item = app.document
         if (!item.parent || !isSiege(item.parent)) return
         if (item.type !== "action") return
         SiegeActionsUI.renderSheetTab(app, html, data, item)
      })
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
                     skills: tpl.skills,
                     isAttack: isAttack,
                     isStrike: tpl.isStrike || false,
                     ammoSlug: isAttack ? defaultAmmo : "",
                     actionType: tpl.actionType || "",
                  },
               },
            },
         },
      ])
   }
}
