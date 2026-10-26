# Files

- [Public API v2 and n8n](api-and-n8n.md) - Team-scoped API tokens, the envelope folderId query contract external callers must respect, and where n8n integration code actually lives.

- [Outbound webhooks and the removed inbound trigger route](outbound-webhooks.md) - How Documenso delivers outbound webhook events in-process through the background job runner, the SSRF guard on delivery, the resend path, and why the inbound /api/webhook/trigger route was deleted. Read before changing webhook dispatch, delivery, or inbound route surface.
