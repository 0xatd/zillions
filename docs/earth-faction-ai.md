# Earth Faction AI

The region worker controls AI armies. The browser only renders the filtered
world projection.

Each region tick verifies the worker ID, lease epoch, and lease expiry. It then
evaluates server-owned armies in stable ID order. The current region tick and
the army ID select a deterministic goal. The same state and command log always
produce the same intent.

The first goal set is `patrol`, `trade`, `raid`, `reinforce`, `pursue`,
`defend`, and `siege_prepare`. Each army stores its current intent, reason,
target, and evaluation tick. This data explains visible movement to players.

This slice accumulates ownership pressure. It does not transfer ownership or
resolve a siege. Those changes require the later ownership and siege slice.
The worker also does not create markets, goods, or battle results in this
slice.

Only the service role can run the region worker function. A stale lease epoch
stops all writes after worker takeover.
