import {
   MODULE_ID,
   DEFAULT_PERSON_IMG,
   DEFAULT_LIFTED_IMG,
} from "../constants.mjs"
import {
   slugify,
   isSiege,
   validImg,
   renderHbs,
   tplPath,
   tKey,
   countOccupants,
   getCrewActors,
   buildStrikeRules,
   getCostGlyph,
   buildCrewLeaderEffect,
} from "../utils.mjs"
import { SiegeCrewManager } from "../managers/crew.mjs"
import { SiegePortableManager } from "../managers/portable.mjs"
import { ensureSiegeCSS } from "./helpers.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"
import { AmmunitionManager } from "../managers/ammunition.mjs"

export async function mountMacro(crewmanActor = null, siegeActor = null) {
   let crewman = crewmanActor
   let siege = siegeActor

   if (!crewman || !siege) {
      const controlled = canvas.tokens.controlled
      const targets = Array.from(game.user.targets)
      if (controlled.length !== 1 || targets.length !== 1)
         return ui.notifications.warn(
            tKey("Notifications.SelectOneCrewmanOneSiege"),
         )
      crewman = controlled[0].actor
      siege = targets[0].actor
   }

   if (!isSiege(siege))
      return ui.notifications.warn(tKey("Notifications.MustBeSiegeWeapon"))

   const existing = crewman.itemTypes.effect.find(
      (e) => e.getFlag(MODULE_ID, "siegeId") === siege.id,
   )
   if (existing) {
      await SiegeCrewManager.dismountCrewman(crewman, siege)
      ui.notifications.info(
         tKey("Notifications.CrewmanDismounted", {
            crewman: crewman.name,
            siege: siege.name,
         }),
      )
      return
   }

   const crewPositions = siege.getFlag(MODULE_ID, "crew") || []
   if (crewPositions.length === 0)
      return ui.notifications.warn(tKey("Notifications.NoCrewPositions"))

   const positionsData = await buildPositionsData(siege, crewPositions)
   const htmlContent = await renderHbs(tplPath("macros/mount.hbs"), {
      positions: positionsData,
      i18n: {
         mountAs: tKey("Buttons.Confirm"),
      },
   })

   class SiegeMountApp extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = {
         classes: ["siege-v2-app", "siege-mount-app"],
         window: { title: tKey("Mount.Title", { name: siege.name }) },
         position: { width: 450, height: "auto" },
      }

      constructor(options) {
         super(options)
         ensureSiegeCSS()
      }

      _renderHTML() {
         return htmlContent
      }
      _replaceHTML(result, content) {
         content.innerHTML = result
      }
      _onRender() {
         $(this.element)
            .find(".mount-btn")
            .on("click", (e) =>
               handleMountClick(e, this, crewman, siege, crewPositions),
            )
      }
   }

   new SiegeMountApp().render(true)
}

export async function buildPositionsData(siege, crewPositions, labelFn = null) {
   const ammoTypes = siege.getFlag(MODULE_ID, "ammunitionTypes") || []
   const actions = siege.items.filter((a) => a.type === "action")

   return crewPositions.map((pos) => {
      const currentOccupants = countOccupants(siege, pos.title)
      const minReq = parseInt(pos.min) || 1
      const maxCap = parseInt(pos.max) || 1
      const isMet = currentOccupants >= minReq

      const posActions = actions
         .filter((a) => {
            const flag = a.getFlag(MODULE_ID, "siegeAction")
            return (
               flag &&
               (!flag.crewAccess ||
                  flag.crewAccess.length === 0 ||
                  flag.crewAccess.includes(pos.title))
            )
         })
         .map((a) => buildActionRow(a, ammoTypes))

      return {
         title: pos.title,
         icon: pos.icon || DEFAULT_PERSON_IMG,
         currentOccupants,
         minReq,
         maxCap,
         isMet,
         isFull: currentOccupants >= maxCap,
         actions: posActions,
         mountLabel: labelFn
            ? labelFn(pos.title)
            : tKey("Mount.MountAs", { position: pos.title }),
      }
   })
}

function buildActionRow(a, ammoTypes) {
   const flag = a.getFlag(MODULE_ID, "siegeAction") || {}
   let ammoName = null

   if (flag.usesAmmunition !== false) {
      const ammoChoices = AmmunitionManager.ammoSlugsForAction(flag)
      if (ammoChoices.length === 0) {
         ammoName = tKey("Ammunition.TypeUnassigned")
      } else {
         const names = ammoChoices
            .map((slug) =>
               ammoTypes.find((t) => slugify(t.slug || t.name) === slug)?.name,
            )
            .filter(Boolean)
         ammoName = names.length
            ? names.join(" / ")
            : tKey("Ammunition.TypeUnassigned")
      }
   }

   const profs = flag.proficiencies || [
      { name: flag.weaponProficiency || "martial", loreName: "" },
   ]
   const profString = profs
      .map((p) => {
         if (p.name === "lore") {
            if (!p.loreName) return tKey("Skills.Lore")
            const clean = p.loreName.replace(/-lore$/i, "").replace(/-/g, " ")
            const titled = clean.replace(/\b\w/g, (c) => c.toUpperCase())
            return tKey("Skills.LoreSuffix", { name: titled })
         }
         const cap = p.name.charAt(0).toUpperCase() + p.name.slice(1)
         const suffix = ["unarmed", "simple", "martial", "advanced"].includes(
            p.name,
         )
            ? tKey("Skills.WeaponSuffix", { name: cap })
            : cap
         return suffix
      })
      .join(", ")

   return {
      name: a.name,
      img: a.img || "icons/svg/item-bag.svg",
      description: a.system.description.value,
      costGlyph: getCostGlyph(a),
      flag,
      hasAmmunition: flag.usesAmmunition !== false && !!ammoName,
      ammoName,
      spend: parseInt(flag.spend) || 1,
      isAttack: flag.isAttack || flag.isStrike,
      isStrike: flag.isStrike,
      isAbility: flag.isAttack && !flag.isStrike,
      isRanged: flag.isRanged !== false,
      prereqs:
         flag.prerequisites && flag.prerequisites.length > 0
            ? flag.prerequisites.map((p) => p.name).join(", ")
            : tKey("Misc.None"),
      damageString: (flag.damageParts || [])
         .map(
            (dp) =>
               `${dp.dice}${dp.die === "-" ? "" : dp.die} ${dp.type} (${dp.category})`,
         )
         .join(", "),
      profString,
   }
}

async function handleMountClick(e, app, crewman, siege, crewPositions) {
   e.preventDefault()
   const chosenPosition = $(e.currentTarget).data("position")
   const posData = crewPositions.find((p) => p.title === chosenPosition)
   const maxAllowed = parseInt(posData?.max) || 1
   const currentOccupants = countOccupants(siege, chosenPosition)

   if (currentOccupants >= maxAllowed) {
      return ui.notifications.warn(
         tKey("Mount.PositionFull", {
            position: chosenPosition,
            max: maxAllowed,
         }),
      )
   }

   const traits = siege.system.traits?.value || []
   const isPortable = traits.includes("portable")
   let liftedBulk = 0
   let isLeader = false

   if (isPortable) {
      const liftResult = await promptForLift(crewman, siege)
      if (!liftResult) return
      liftedBulk = liftResult.liftedBulk
      isLeader = liftResult.isLeader
   }

   const rules = buildAllStrikeRules(siege, chosenPosition, crewman)
   const totalBulk = parseInt(siege.getFlag(MODULE_ID, "bulk")) || 0
   const embeddedDocs = buildMountedDocs(
      siege,
      chosenPosition,
      posData,
      rules,
      isPortable,
      liftedBulk,
      totalBulk,
      isLeader,
   )

   await SiegeSocketManager.modifySiegeItem(
      crewman.uuid,
      "create",
      embeddedDocs,
   )

   ui.notifications.info(
      tKey("Notifications.CrewmanMounted", {
         crewman: crewman.name,
         siege: siege.name,
         position: chosenPosition,
      }),
   )
   if (isPortable) await SiegePortableManager.syncPortableState(siege)
   await SiegeCrewManager.updateSiegeSpeed(siege)
   app.close()
}

function buildAllStrikeRules(siege, chosenPosition, actor = null) {
   const rules = []
   const actions = siege.items.filter((a) => a.type === "action")

   for (const a of actions) {
      const flag = a.getFlag(MODULE_ID, "siegeAction")
      if (!flag || !flag.isStrike) continue
      if (
         flag.crewAccess?.length > 0 &&
         !flag.crewAccess.includes(chosenPosition)
      )
         continue

      rules.push(
         ...buildStrikeRules(siege, { ...flag, strikeLabel: a.name }, actor),
      )
   }
   return rules
}

function buildMountedDocs(
   siege,
   chosenPosition,
   posData,
   rules,
   isPortable,
   liftedBulk,
   totalBulk,
   isLeader,
) {
   const docs = [
      {
         name: tKey("Markers.MountedOnPosition", {
            siege: siege.name,
            position: chosenPosition,
         }),
         type: "effect",
         img: validImg(posData?.icon, DEFAULT_PERSON_IMG),
         system: {
            level: { value: 1 },
            description: {
               value: tKey("Mount.MarkerDescription", {
                  siege: siege.name,
                  position: chosenPosition,
               }),
            },
            tokenIcon: { show: true },
            rules,
         },
         flags: {
            [MODULE_ID]: {
               position: chosenPosition,
               siegeId: siege.id,
               siegeUuid: siege.uuid,
            },
         },
      },
   ]

   if (isPortable) {
      docs.push(
         {
            name: tKey("Markers.LiftedItem", { name: siege.name }),
            type: "equipment",
            img: validImg(siege.img, DEFAULT_LIFTED_IMG),
            system: {
               description: { value: tKey("Markers.LiftedItemDesc") },
               bulk: { value: liftedBulk },
            },
            flags: { [MODULE_ID]: { isLiftedItem: true, siegeId: siege.id } },
         },
         {
            name: `Lifting ${siege.name}`,
            type: "effect",
            img: validImg(siege.img, DEFAULT_LIFTED_IMG),
            system: {
               level: { value: 1 },
               badge: { type: "counter", value: liftedBulk, min: 1 },
               description: {
                  value: tKey("Markers.LiftingDesc", { name: siege.name }),
               },
               tokenIcon: { show: true },
            },
            flags: {
               [MODULE_ID]: { isLiftingEffect: true, siegeId: siege.id },
            },
         },
      )
   }

   if (isLeader) {
      docs.push(buildCrewLeaderEffect(siege.id))
   }

   return docs
}

async function promptForLift(crewman, siege) {
   const totalBulk = siege.getFlag(MODULE_ID, "bulk") || 0
   let currentlyLifted = 0
   const lifters = []
   let hasLeader = false

   for (const actor of getCrewActors(siege)) {
      const liftItem = actor.items.find(
         (i) =>
            i.getFlag(MODULE_ID, "isLiftedItem") &&
            i.getFlag(MODULE_ID, "siegeId") === siege.id,
      )
      if (liftItem) {
         const bulk = liftItem.system.bulk?.value || 0
         currentlyLifted += bulk

         const isLeader = actor.itemTypes.effect.some(
            (e) =>
               e.getFlag(MODULE_ID, "isCrewLeader") &&
               e.getFlag(MODULE_ID, "siegeId") === siege.id,
         )
         if (isLeader) hasLeader = true
         const leaderStr = isLeader ? " 👑" : ""

         lifters.push(`${actor.name}: ${bulk} Bulk${leaderStr}`)
      }
   }

   const capData = SiegePortableManager._getLifterCapacity(crewman, 0)
   const remainingBulk = Math.max(0, totalBulk - currentlyLifted)
   const maxLift = Math.max(0, Math.min(remainingBulk, capData.capacity))

   const templateData = {
      lifters,
      totalBulk,
      maxLift,
      capData: {
         otherBulk: capData.otherBulk,
         
         
         
         encumberedAfter: capData.encumberedAfter,
         maxLimit: capData.maxLimit,
      },
      i18n: {
         currentLifters: tKey("Mount.CurrentLifters"),
         none: tKey("Mount.None"),
         bulkLifted: tKey("Mount.BulkLifted", {
            lifted: currentlyLifted,
            total: totalBulk,
         }),
         carryingCapacity: tKey("Mount.CarryingCapacity"),
         currentBulk: tKey("Mount.CurrentBulk"),
         bulkToLift: tKey("Mount.BulkToLift"),
         encumberedLabel: tKey("Mount.EncumberedLabel", {
            value: capData.encumberedAfter,
         }),
         maxBulkLabel: tKey("Mount.MaxBulkLabel", { value: capData.maxLimit }),
      },
   }

   const dialogContent = await renderHbs(
      tplPath("macros/lift.hbs"),
      templateData,
   )

   const leaderHtml = `
      <div class="form-group" style="display: flex; align-items: center; justify-content: flex-start; gap: 8px;">
         <label style="flex: 0 0 auto;"><i class="fa-solid fa-crown" style="color: gold;"></i> ${tKey("Mount.CrewLeaderCheckbox")}</label>
         <input type="checkbox" id="lift-crew-leader" style="flex: 0 0 auto; margin: 0; cursor: ${hasLeader ? "not-allowed" : "pointer"};" ${hasLeader ? "disabled" : ""}>
      </div>`
   const finalContent = dialogContent + leaderHtml

   const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Mount.LiftTitle", { name: siege.name }) },
      position: { width: 480 },
      content: finalContent,
      buttons: [
         {
            action: "lift",
            label: tKey("Mount.LiftAndMount"),
            icon: "fa-solid fa-hand-rock",
            callback: () => {
               const val =
                  parseInt(document.getElementById("lift-bulk-input")?.value) ||
                  0
               const isLeader =
                  document.getElementById("lift-crew-leader")?.checked || false
               return { liftedBulk: val, isLeader }
            },
         },
      ],
      render: () => bindLiftInput(currentlyLifted, totalBulk, capData, maxLift),
   })

   if (!choice) return null
   let liftedBulk =
      choice.liftedBulk < 0
         ? 0
         : choice.liftedBulk > maxLift
           ? maxLift
           : choice.liftedBulk
   return { liftedBulk, isLeader: choice.isLeader }
}

function bindLiftInput(currentlyLifted, totalBulk, capData, maxLift) {
   const input = document.getElementById("lift-bulk-input")
   const tracker = document.getElementById("lifted-tracker")
   const addBulk = document.getElementById("lift-add-bulk")
   const totBulk = document.getElementById("lift-tot-bulk")
   const curBulkSpan = document.getElementById("lift-cur-bulk")

   const getColor = (val) => {
      
      if (val >= capData.maxLimit) return "red"
      
      
      if (val > capData.encumberedAfter) return "orange"
      return "green"
   }

   if (curBulkSpan) curBulkSpan.style.color = getColor(capData.otherBulk)
   if (totBulk) totBulk.style.color = getColor(capData.otherBulk)

   if (!input) return

   input.addEventListener("input", () => {
      let val = parseInt(input.value) || 0
      if (val < 0) val = 0
      if (val > maxLift) {
         val = maxLift
         input.value = String(maxLift)
      }
      if (tracker)
         tracker.innerText = tKey("Mount.BulkLifted", {
            lifted: currentlyLifted + val,
            total: totalBulk,
         })
      if (addBulk) addBulk.innerText = val
      if (totBulk) {
         const total = capData.otherBulk + val
         totBulk.innerText = total
         totBulk.style.color = getColor(total)
      }
   })
}
