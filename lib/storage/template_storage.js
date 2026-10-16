// The internal storage, one per process. Templates are scoped by observation domain, as RFC 7011 (Observation Domain
// ID) and RFC 3954 (Source ID) scope them: each map is keyed `${domainId}:${templateId}`.
module.exports = {
    DataTemplateMap: new Map(),
    OptionsTemplateMap: new Map(),
};
