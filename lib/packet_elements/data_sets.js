var DataSetRecord = require("./flow_set_elements/data_set/record");
var Sets = require("./sets");

/**
 * Reads a data set, an IPFIX Data Set or a NetFlow v9 Data FlowSet, into packet.DataSets with the template of its id;
 * what is left unread is listed in packet.SkippedSets. framingOf(template, body) is how the protocol frames the
 * template's records (see Sets.walkRecords).
 */
var readDataSet = function (packet, params, templates, framingOf, setId, setDataLength, body)
{
    var template = templates.forDataSet(setId);
    if (template == null)
        return;

    Sets.walkRecords(setId, template, setDataLength, framingOf(template, body), packet.SkippedSets, function (index, length)
    {
        var flow = new DataSetRecord(body.slice(index, index + length), { template: template, parseDataValues: params.parseDataValues });
        flow.templateId = template.templateId;
        packet.DataSets.push(flow);
    });
};

module.exports = readDataSet;
