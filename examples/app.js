var net = require('net');
// Not really sophisticated storing mechanism over here, for one exporter. Used just for the example.
var DataTemplates = new Map();
var OptionTemplates = new Map();
var decoder = require('ipfix_node')({
    // Over TCP the exporter's template withdrawals are honored (RFC 7011 section 8.1)
    transport: 'tcp',
    useInternalStorage: false,
    onNewTemplate: function(template, templateType){
        if(templateType == 'DataTemplate')
            DataTemplates.set(template.templateId, template);
        else if(templateType == 'OptionsTemplate')
            OptionTemplates.set(template.templateId, template);
    },
    onTemplateWithdrawal: function(templateId, templateType){
        var templates = templateType == 'DataTemplate' ? DataTemplates : OptionTemplates;
        // A template id of 2 or 3 withdraws all templates of the kind
        if(templateId == 2 || templateId == 3)
            templates.clear();
        else
            templates.delete(templateId);
    },
    templateProvider: function(templateId){
        if(DataTemplates.has(templateId))
            return DataTemplates.get(templateId);
        else if(OptionTemplates.has(templateId))
            return OptionTemplates.get(templateId);
    }
});
// TCP Server where you are expecting binary buffers from flow exporting software like "softflowd" 
var server = net.createServer(function(socket){
    // A TCP read holds part of a message or several: each IPFIX message is cut by the Length of its header
    var received = Buffer.alloc(0);
    socket.on('data', function(data){
        received = Buffer.concat([received, data]);
        while(received.length >= 4){
            var length = received.readUInt16BE(2);
            if(length < 16){
                console.log('Not an IPFIX stream !');
                socket.destroy();
                return;
            }
            if(received.length < length)
                break;
            var message = received.slice(0, length);
            received = received.slice(length);
            decoder.deserialize(message)
                .then(function(decodedData){
                    var TemplateSets = decodedData.TemplateSets;
                    var OptionTemplateSets = decodedData.OptionsTemplateSets;
                    var DataSets = decodedData.DataSets;
                    console.log('----   TEMPLATE SETS   ----');
                    TemplateSets.forEach(function(val, i){
                        var fields = val.FieldSpecifiers;
                        fields.forEach(function(field,j){
                            console.log(field);
                        });
                    });
                    console.log('----   OPTIONS TEMPLATE SETS   ----');
                    OptionTemplateSets.forEach(function(val, i){
                        var fields = val.FieldSpecifiers;
                        fields.forEach(function(field,j){
                            console.log(field);
                        });
                    });

                    console.log('----   DATA SETS   ----');
                    DataSets.forEach(function(val, i){
                        var fields = val.Fields;
                        fields.forEach(function(field,j){
                            console.log(field);
                        });
                    });

                    console.log('----   SKIPPED SETS   ----');
                    decodedData.SkippedSets.forEach(function(skipped){
                        console.log(skipped);
                    });
                })
                .catch(function(err){
                    console.log(err);
                });
        }
    });
    socket.on('error', function(err){
        console.log('Socket error !');
        console.log(err);
    })
    socket.on('close', function(){
        // The end of the session withdraws its templates (RFC 7011 section 8.1)
        DataTemplates.clear();
        OptionTemplates.clear();
        console.log('Socket died !');
    })
});
// Server listening on port 8008
server.listen(8008);
