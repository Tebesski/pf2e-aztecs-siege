import { MODULE_ID } from "../../constants.mjs"
import { slugify, tKey } from "../../utils.mjs"
import { SiegeSettings } from "../../managers/settings.mjs"
import { DEFAULT_DAMAGE_PART, normalizeConsequences } from "./consequences.mjs"
import { bindConsequenceListeners } from "./consequence-listeners.mjs"

export function validateRuleElementText(text) {
   try {
      const parsed = JSON.parse(text || "")
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
         return {
            valid: false,
            message: tKey("ActionTab.InvalidRuleElement"),
         }
      if (typeof parsed.key !== "string" || parsed.key.trim() === "")
         return {
            valid: false,
            message: tKey("ActionTab.RuleElementMissingKey"),
         }
      return { valid: true, message: tKey("ActionTab.ValidRuleElement") }
   } catch (_err) {
      return { valid: false, message: tKey("ActionTab.InvalidJSON") }
   }
}

export function refreshRuleValidation(html) {
   html.find(".consequence-rule-json").each((_idx, el) => {
      const row = $(el).closest(".siege-consequence-row")
      const status = row.find(".consequence-rule-status")
      const result = validateRuleElementText(el.value)
      status
         .text(result.message)
         .toggleClass("valid", result.valid)
         .toggleClass("invalid", !result.valid)
   })
   html.find(".save-consequence-rule-json").each((_idx, el) => {
      const row = $(el).closest(".siege-save-consequence-row")
      const status = row.find(".save-consequence-rule-status")
      const result = validateRuleElementText(el.value)
      status
         .text(result.message)
         .toggleClass("valid", result.valid)
         .toggleClass("invalid", !result.valid)
   })
}

export async function refreshEffectValidation(html) {
   const validateRows = async (rows, selectors) => {
      for (const rowEl of rows) {
         const row = $(rowEl)
         const input = row.find(selectors.input)
         if (!input.length) continue
         const uuid = String(input.val() || "").trim()
         const icon = row.find(selectors.icon)
         const link = row.find(selectors.link)
         if (!uuid) {
            icon.attr("src", "icons/svg/aura.svg")
            link
               .text(tKey("ActionTab.NoEffectUUID"))
               .removeAttr("data-uuid")
               .removeClass("valid")
               .addClass("invalid")
            continue
         }
         let doc = null
         try {
            doc = await fromUuid(uuid)
         } catch (_err) {}
         const isEffect = doc?.documentName === "Item" && doc.type === "effect"
         icon.attr("src", isEffect ? doc.img || "icons/svg/aura.svg" : "icons/svg/hazard.svg")
         link
            .text(isEffect ? doc.name : tKey("ActionTab.InvalidUUID"))
            .toggleClass("valid", isEffect)
            .toggleClass("invalid", !isEffect)
         if (isEffect) link.attr("data-uuid", uuid)
         else link.removeAttr("data-uuid")
      }
   }
   await validateRows(html.find(".siege-consequence-row").toArray(), {
      input: ".consequence-effect-uuid",
      icon: ".consequence-effect-icon",
      link: ".consequence-effect-link",
   })
   await validateRows(html.find(".siege-save-consequence-row").toArray(), {
      input: ".save-consequence-effect-uuid",
      icon: ".save-consequence-effect-icon",
      link: ".save-consequence-effect-link",
   })
}

export function refreshConsequenceValidations(html) {
   refreshRuleValidation(html)
   refreshEffectValidation(html)
}

function dragData(event) {
   const ev = event?.originalEvent || event
   try {
      const data = globalThis.TextEditor?.getDragEventData?.(ev)
      if (data) return data
   } catch (_err) {}

   const tryParse = (raw) => {
      if (!raw) return null
      try {
         return JSON.parse(raw)
      } catch (_err) {
         return null
      }
   }
   return (
      tryParse(ev?.dataTransfer?.getData("application/json")) ||
      tryParse(ev?.dataTransfer?.getData("text/json")) ||
      tryParse(ev?.dataTransfer?.getData("text/plain"))
   )
}

async function effectFromDrop(event) {
   const data = dragData(event)
   const uuid = data?.uuid || data?.itemUuid || data?.documentUuid
   if (!uuid) return null
   const doc = await fromUuid(uuid).catch(() => null)
   if (doc?.documentName === "Item" && doc.type === "effect") return doc
   return null
}

export function bindActionTabListeners(actionsUI, app, item, html, flags) {
   flags.consequences = normalizeConsequences(flags.consequences)

   const saveFlags = async (render = false) => {
      await item.update(
         { [`flags.${MODULE_ID}.siegeAction`]: flags },
         render ? {} : { render: false },
      )
   }

   const normalizeLoadActionsRequired = () => {
      if (
         (flags.isAttack || flags.isStrike) &&
         flags.usesAmmunition !== false &&
         (Number(flags.loadActionsRequired) || 0) < 1
      )
         flags.loadActionsRequired = 1
   }

   const setFlagWithScroll = async () => {
      actionsUI._captureScroll(app, html)
      await item.update({ [`flags.${MODULE_ID}.siegeAction`]: flags })
   }

   html.find("[data-action-path]").on("change", async (e) => {
      const el = e.currentTarget
      const path = el.dataset.actionPath
      let value
      if (el.type === "checkbox") value = el.checked
      else if (el.type === "number") value = Number(el.value) || 0
      else value = el.value
      flags[path] = value
      normalizeLoadActionsRequired()
      if (path === "loadActionsRequired") el.value = flags.loadActionsRequired
      if (path === "isComponent" && value && !flags.componentType) {
         const firstType = SiegeSettings.moduleTypes()[0]
         if (firstType) flags.componentType = firstType
         else ui.notifications.warn(tKey("Modules.NoModuleTypes"))
      }
      if (path === "isComponent" && !value) flags.componentType = ""
      if (path === "usesAmmunition" || path === "isComponent") await setFlagWithScroll()
      else await saveFlags()
   })

   const setSectionVisible = (selector, visible) => {
      const section = html.find(selector)
      section.css("display", visible ? "" : "none")
   }

   const toggleSection = (cbSelector, sectionSelector) =>
      html.find(cbSelector).on("change", (e) => {
         setSectionVisible(sectionSelector, e.target.checked)
      })

   toggleSection(".siege-is-ranged-cb", ".siege-ranged-settings")
   toggleSection(".siege-uses-ammo-cb", ".siege-ammo-settings")

   html.find(".siege-unlimited-cb").on("change", (e) => {
      html.find(".siege-effect-duration").prop("disabled", e.target.checked)
   })

   html.find(".siege-action-type-select").on("change", (e) => {
      const val = $(e.currentTarget).val()
      const isArea = val === "area-fire" || val === "auto-fire"
      const isSave = isArea || val === "save-single"
      setSectionVisible(".siege-area-settings", isArea)
      setSectionVisible(".siege-save-settings", isSave)
      setSectionVisible(".siege-damage-settings", isSave)
   })

   html.find(".add-crew-access-select").on("change", async (e) => {
      const val = $(e.currentTarget).val()
      if (!val) return
      if (!flags.crewAccess.includes(val)) flags.crewAccess.push(val)
      await setFlagWithScroll()
   })

   html.find(".add-required-rank-select").on("change", async (e) => {
      const val = $(e.currentTarget).val()
      if (!val) return
      flags.requiredRanks = flags.requiredRanks || []
      if (!flags.requiredRanks.includes(val)) flags.requiredRanks.push(val)
      await setFlagWithScroll()
   })

   html.find(".add-action-ammo-select").on("change", async (e) => {
      const val = slugify($(e.currentTarget).val())
      if (!val) return
      flags.ammoSlugs = flags.ammoSlugs || []
      if (!flags.ammoSlugs.includes(val)) flags.ammoSlugs.push(val)
      if (!flags.ammoSlug) flags.ammoSlug = flags.ammoSlugs[0] || ""
      await setFlagWithScroll()
   })

   html.find(".remove-action-ammo").on("click", async (e) => {
      e.preventDefault()
      const slug = slugify($(e.currentTarget).data("slug"))
      flags.ammoSlugs = (flags.ammoSlugs || []).filter((s) => s !== slug)
      flags.ammoSlug = flags.ammoSlugs[0] || ""
      await setFlagWithScroll()
   })

   html.find(".remove-required-rank").on("click", async (e) => {
      const rank = $(e.currentTarget).data("rank")
      flags.requiredRanks = (flags.requiredRanks || []).filter(
         (r) => r !== String(rank),
      )
      await setFlagWithScroll()
   })

html.find(".add-savedc-path").on("click", async (e) => {
      e.preventDefault()
      const input = $(e.currentTarget).siblings(".siege-savedc-input")
      const val = (input.val() || "").trim()
      if (!val) return
      flags.saveDCPaths = flags.saveDCPaths || []
      flags.saveDCPaths.push(val)
      await setFlagWithScroll()
   })

   html.find(".siege-savedc-input").on("keydown", async (e) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      const val = ($(e.currentTarget).val() || "").trim()
      if (!val) return
      flags.saveDCPaths = flags.saveDCPaths || []
      flags.saveDCPaths.push(val)
      await setFlagWithScroll()
   })

   html.find(".remove-savedc-path").on("click", async (e) => {
      const idx = $(e.currentTarget).data("index")
      flags.saveDCPaths = flags.saveDCPaths || []
      flags.saveDCPaths.splice(idx, 1)
      await setFlagWithScroll()
   })

   html.find(".remove-crew-access").on("click", async (e) => {
      const idx = $(e.currentTarget).data("index")
      flags.crewAccess.splice(idx, 1)
      await setFlagWithScroll()
   })

   html.find(".add-prereq-select").on("change", async (e) => {
      const val = $(e.currentTarget).val()
      if (!val) return
      if (!flags.prerequisites.some((p) => p.name === val))
         flags.prerequisites.push({ name: val, count: 1 })
      await setFlagWithScroll()
   })

   html.find(".remove-prereq").on("click", async (e) => {
      const idx = $(e.currentTarget).data("index")
      flags.prerequisites.splice(idx, 1)
      await setFlagWithScroll()
   })

   html.find(".prereq-count-input").on("change", async (e) => {
      const el = $(e.currentTarget)
      const idx = el.data("index")
      let val = parseInt(el.val()) || 1
      if (val < 1) val = 1
      flags.prerequisites[idx].count = val
      await saveFlags()
   })

   html.find(".add-skill").on("click", async (e) => {
      e.preventDefault()
      flags.skills.push({ name: "athletics", loreName: "", dc: "" })
      await setFlagWithScroll()
   })

   html.find(".remove-skill").on("click", async (e) => {
      e.preventDefault()
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("ActionTab.RemoveSkill") },
         content: `<p>${tKey("ActionTab.RemoveSkillConfirm")}</p>`,
         rejectClose: false,
      })
      if (!confirmed) return
      const idx = $(e.currentTarget).closest(".siege-skill-row").data("index")
      flags.skills.splice(idx, 1)
      await setFlagWithScroll()
   })

   html
      .find(".skill-name, .lore-name, .skill-dc")
      .on("change", async (e) => {
         const row = $(e.currentTarget).closest(".siege-skill-row")
         const idx = row.data("index")
         const dcVal = String(row.find(".skill-dc").val() ?? "").trim()
         const isLore = row.find(".skill-name").val() === "lore"

         row.find(".lore-name").toggle(isLore)

         flags.skills[idx] = {
            name: row.find(".skill-name").val(),
            loreName: isLore
               ? actionsUI._normalizeLoreName(row.find(".lore-name").val())
               : "",
            dc: dcVal,
         }
         await saveFlags()
      })

   html.find(".add-damage-part").on("click", async (e) => {
      e.preventDefault()
      flags.damageParts.push({ ...DEFAULT_DAMAGE_PART })
      await setFlagWithScroll()
   })

   html.find(".add-prof").on("click", async (e) => {
      e.preventDefault()
      flags.proficiencies.push({ name: "martial", loreName: "" })
      await setFlagWithScroll()
   })

   html.find(".remove-prof").on("click", async (e) => {
      e.preventDefault()
      if (flags.proficiencies.length <= 1)
         return ui.notifications.warn(
            tKey("Notifications.MustHaveOneProficiency"),
         )
      const idx = $(e.currentTarget).closest(".prof-row").data("index")
      flags.proficiencies.splice(idx, 1)
      await setFlagWithScroll()
   })

   html.find(".prof-name, .prof-lore-name").on("change", async (e) => {
      const row = $(e.currentTarget).closest(".prof-row")
      const idx = row.data("index")
      const isLore = row.find(".prof-name").val() === "lore"
      row.find(".prof-lore-name").toggle(isLore)
      flags.proficiencies[idx] = {
         name: row.find(".prof-name").val(),
         loreName: isLore
            ? actionsUI._normalizeLoreName(row.find(".prof-lore-name").val())
            : "",
      }
      await saveFlags()
   })

   html.find(".remove-damage-part").on("click", async (e) => {
      e.preventDefault()
      const confirmed = await foundry.applications.api.DialogV2.confirm({
         classes: ["siege-v2-dialog"],
         window: { title: tKey("ActionTab.RemoveDamagePart") },
         content: `<p>${tKey("ActionTab.RemoveDamageConfirm")}</p>`,
         rejectClose: false,
      })
      if (!confirmed) return
      const idx = $(e.currentTarget).closest(".damage-part-row").data("index")
      flags.damageParts.splice(idx, 1)
      await setFlagWithScroll()
   })

   html
      .find(".dp-dice, .dp-die, .dp-type, .dp-category")
      .on("change", async (e) => {
         const row = $(e.currentTarget).closest(".damage-part-row")
         const idx = row.data("index")
         flags.damageParts[idx] = {
            dice: parseInt(row.find(".dp-dice").val()) || 0,
            die: row.find(".dp-die").val(),
            type: row.find(".dp-type").val(),
            category: row.find(".dp-category").val(),
         }
         await saveFlags()
      })

   bindConsequenceListeners({
      html,
      flags,
      saveFlags,
      setFlagWithScroll,
      refreshEffectValidation,
      refreshRuleValidation,
      effectFromDrop,
   })
}
