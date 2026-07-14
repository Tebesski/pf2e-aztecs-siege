export async function withSiegeOriginToken(actor, siege, callback, options = {}) {
   const tokenDoc = _siegeOriginTokenDocument(siege)
   return _withSiegeOriginToken(actor, callback, { ...options, tokenDoc })
}

export async function withSiegeRangeOrigin(actor, siege, callback, options = {}) {
   const tokenDoc = _siegeOriginTokenDocument(siege)
   return _withSiegeOriginToken(actor, callback, { ...options, tokenDoc })
}

async function _withSiegeOriginToken(actor, callback, options = {}) {
   const tokenDoc = options.tokenDoc
   if (!actor || !tokenDoc || typeof actor.getActiveTokens !== "function")
      return callback()

   const siegeToken = _tokenObject(tokenDoc)
   const crewTokens = _crewTokenObjects(actor)
   const originalDescriptor = Object.getOwnPropertyDescriptor(
      actor,
      "getActiveTokens",
   )
   const hadOwnMethod = Object.prototype.hasOwnProperty.call(
      actor,
      "getActiveTokens",
   )
   const replacement = function (...args) {
      const wantsDocument = args[1] === true
      return [wantsDocument ? tokenDoc : siegeToken || tokenDoc]
   }

   const patchedDistances = []
   if (siegeToken?.distanceTo) {
      for (const token of crewTokens) {
         if (!token || token === siegeToken || typeof token.distanceTo !== "function")
            continue
         const originalDistanceTo = token.distanceTo
         const replacementDistanceTo = function (target, options = {}) {
            return siegeToken.distanceTo(target, options)
         }
         try {
            token.distanceTo = replacementDistanceTo
            patchedDistances.push({ token, originalDistanceTo })
         } catch (_err) {}
      }
   }

   let actorMethodPatched = false
   try {
      Object.defineProperty(actor, "getActiveTokens", {
         configurable: true,
         value: replacement,
      })
      actorMethodPatched = true
   } catch (_err) {
      try {
         actor.getActiveTokens = replacement
         actorMethodPatched = true
      } catch (_innerErr) {}
   }

   try {
      return await callback()
   } finally {
      for (const { token, originalDistanceTo } of patchedDistances) {
         token.distanceTo = originalDistanceTo
      }
      if (actorMethodPatched) {
         if (hadOwnMethod && originalDescriptor) {
            Object.defineProperty(actor, "getActiveTokens", originalDescriptor)
         } else {
            delete actor.getActiveTokens
         }
      }
   }
}

function _siegeOriginTokenDocument(siege) {
   const activeDoc = siege?.getActiveTokens?.(true, true)?.[0]
   if (activeDoc) return activeDoc.document || activeDoc
   const activeToken = siege?.getActiveTokens?.()?.[0]
   return activeToken?.document || activeToken || null
}

function _crewTokenObjects(actor) {
   const tokens = []
   const add = (token) => {
      const object = _tokenObject(token)
      if (!object || tokens.includes(object)) return
      if (actor?.id && object.actor?.id && object.actor.id !== actor.id) return
      tokens.push(object)
   }
   try {
      for (const token of actor?.getActiveTokens?.(true, false) || []) add(token)
   } catch (_err) {}
   try {
      for (const token of actor?.getActiveTokens?.(false, false) || []) add(token)
   } catch (_err) {}
   for (const token of canvas?.tokens?.placeables || []) {
      if (token.actor?.id === actor?.id || token.actor?.uuid === actor?.uuid)
         add(token)
   }
   return tokens
}

function _tokenObject(tokenOrDoc) {
   if (!tokenOrDoc) return null
   if (tokenOrDoc.document) return tokenOrDoc
   if (tokenOrDoc.object) return tokenOrDoc.object
   const id = tokenOrDoc.id || tokenOrDoc._id
   return (id ? canvas?.tokens?.get?.(id) : null) || null
}
