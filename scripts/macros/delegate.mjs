import { MODULE_ID } from "../constants.mjs"
import { tKey } from "../utils.mjs"
import { SiegePortableManager } from "../managers/portable.mjs"
import { SiegeSocketManager } from "../managers/sockets.mjs"

export async function delegateWeightMacro(crewman, siege) {
   if (!crewman || !siege) return
   const traits = siege.system.traits?.value || []
   if (!traits.includes("portable"))
      return ui.notifications.warn(tKey("Notifications.DelegateOnlyPortable"))

   const myLifted = crewman.items.find(
      (i) =>
         i.getFlag(MODULE_ID, "isLiftedItem") &&
         i.getFlag(MODULE_ID, "siegeId") === siege.id,
   )
   const myEffect = crewman.items.find(
      (i) =>
         i.getFlag(MODULE_ID, "isLiftingEffect") &&
         i.getFlag(MODULE_ID, "siegeId") === siege.id,
   )

   if (!myLifted || !myEffect)
      return ui.notifications.warn(
         tKey("Notifications.NotLifting", {
            name: crewman.name,
            siege: siege.name,
         }),
      )

   const myBulk = myLifted.system?.bulk?.value || 0
   if (myBulk <= 0)
      return ui.notifications.warn(
         tKey("Notifications.NothingToDelegate", { name: crewman.name }),
      )

   const targets = SiegePortableManager._collectLifters(siege, crewman.id)
   if (targets.length === 0)
      return ui.notifications.warn(
         tKey("Notifications.NotCrewMembersToDelegate"),
      )

   const options = targets
      .map((t) => {
         const label = tKey("Delegate.TargetOption", {
            name: t.actor.name,
            current: t.currentBulk,
            capacity: t.capacity,
         })
         return `<option value="${t.actor.id}" data-cap="${t.capacity}" data-cur="${t.currentBulk}">${label}</option>`
      })
      .join("")

   const content = `
      <div class="siege-delegate-dialog">
         <p>${tKey("Delegate.LiftingDescription", { bulk: myBulk, name: siege.name })}</p>
      </div>
      <div class="form-group">
         <label>${tKey("Delegate.DelegateTo")}</label>
         <select id="delegate-target">${options}</select>
      </div>
      <div class="form-group">
         <label>${tKey("Delegate.BulkToDelegate")}</label>
         <input type="number" id="delegate-amount" value="1" min="1" max="${myBulk}">
      </div>
      <p id="delegate-warn" class="siege-warn"></p>
   `

   const choice = await foundry.applications.api.DialogV2.wait({
      classes: ["siege-v2-dialog"],
      window: { title: tKey("Delegate.Title", { name: siege.name }) },
      position: { width: 480 },
      content,
      buttons: [
         {
            action: "delegate",
            label: tKey("Delegate.DelegateButton"),
            icon: "fa-solid fa-people-arrows",
            callback: () => ({
               targetId:
                  document.getElementById("delegate-target")?.value || null,
               amount:
                  parseInt(document.getElementById("delegate-amount")?.value) ||
                  0,
            }),
         },
      ],
      render: () => bindDelegateForm(myBulk),
   })

   if (!choice || !choice.targetId || choice.amount <= 0) return

   const target = targets.find((t) => t.actor.id === choice.targetId)
   if (!target)
      return ui.notifications.warn(tKey("Notifications.TargetNoLongerValid"))

   let amount = Math.min(choice.amount, myBulk)
   const headroom = Math.max(0, target.capacity - target.currentBulk)
   if (amount > headroom) {
      ui.notifications.warn(
         tKey("Delegate.CapDelegation", { name: target.actor.name, headroom }),
      )
      amount = headroom
   }
   if (amount <= 0) return

   const newMyBulk = myBulk - amount
   const newTheirBulk = target.currentBulk + amount

   await SiegeSocketManager.modifySiegeItem(
      crewman.uuid,
      "update",
      [
         { _id: myLifted.id, "system.bulk.value": newMyBulk },
         { _id: myEffect.id, "system.badge.value": newMyBulk },
      ],
      { siegeDropCascade: true },
   )

   const targetUpdates = [
      { _id: target.liftedItem.id, "system.bulk.value": newTheirBulk },
   ]
   if (target.liftingEffect)
      targetUpdates.push({
         _id: target.liftingEffect.id,
         "system.badge.value": newTheirBulk,
      })
   await SiegeSocketManager.modifySiegeItem(
      target.actor.uuid,
      "update",
      targetUpdates,
      { siegeDropCascade: true },
   )

   ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: crewman }),
      content: tKey("Delegate.Delegated", {
         crewman: crewman.name,
         amount,
         siege: siege.name,
         target: target.actor.name,
      }),
   })

   await SiegePortableManager.syncPortableState(siege)
}

function bindDelegateForm(myBulk) {
   const select = document.getElementById("delegate-target")
   const input = document.getElementById("delegate-amount")
   const warn = document.getElementById("delegate-warn")
   if (!select || !input || !warn) return

   const refresh = () => {
      const opt = select.options[select.selectedIndex]
      const cap = parseInt(opt?.dataset?.cap) || 0
      const cur = parseInt(opt?.dataset?.cur) || 0
      const headroom = Math.max(0, cap - cur)
      const val = parseInt(input.value) || 0
      if (val <= 0) warn.innerText = tKey("Delegate.AmountAtLeastOne")
      else if (val > myBulk)
         warn.innerText = tKey("Delegate.AtMost", { max: myBulk })
      else if (val > headroom)
         warn.innerText = tKey("Delegate.TargetCanAccept", { headroom })
      else warn.innerText = ""
   }
   select.addEventListener("change", refresh)
   input.addEventListener("input", refresh)
   refresh()
}
