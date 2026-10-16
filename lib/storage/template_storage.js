// The internal storage, one per process. Templates are scoped as RFC 7011 and RFC 3954 scope them, by transport session
// (the session given to deserialize, if any) and observation domain (Observation Domain ID, Source ID), and kept apart
// per protocol version: each map is keyed `[<session>/]<version>/<domainId>/<templateId>`.
module.exports = {
    DataTemplateMap: new Map(),
    OptionsTemplateMap: new Map(),
};
