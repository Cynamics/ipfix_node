### Ipfix deserializer in Node.js.

##### This module is still in development mode.
##### Its purpose is to deserialize ipfix NetFlows exported from software like "softflowd", and return them as [entity data](https://www.iana.org/assignments/ipfix/ipfix.xhtml).

### **Installation**
```
npm install ipfix_node
```

### Usage
```javascript
var IpfixDeserializer = require('ipfix_node')();

IpfixDeserializer.deserialize(data)
    .then(function(deserializedData) {
        // Do something with deserialized data (JSON format)
    })
    .catch(function(err) {
        // Catch errors ...
    });

```

"data" parameter is the Buffer data collected from a netflow exporting software: one message per call. An IPFIX message is read up to the Length its header gives; over TCP, split the stream into messages by that Length before calling. A buffer too short to hold a version is rejected.

An optional second parameter names the transport session the message arrived on, such as the exporter's address and port: `deserialize(data, rinfo.address + ":" + rinfo.port)`. The internal storage keeps each session's templates apart, as [RFC 7011 section 3.4.1](https://tools.ietf.org/html/rfc7011#section-3.4.1) scopes template ids to the transport session and observation domain. The <b>session</b> option gives the session of every message a deserializer reads, when the call gives none.

When a TCP connection or an SCTP association ends, call `deserializer.endSession(session)`: it removes the session's templates from the internal storage, as the end of a session withdraws them ([RFC 7011 section 8.1](https://tools.ietf.org/html/rfc7011#section-8.1)), and keeps the storage from growing with every closed session. `endSession()` with no session ends the session of the <b>session</b> option, as `deserialize` falls back to it, or else that of the messages given none. With <b>useInternalStorage:false</b> it drops the session's pending templates (see [templateProvider](#templateProvider)); remove the ones you stored yourself.

The library is using internal Maps for storing [Template Records](https://tools.ietf.org/html/rfc7011#section-3.4.1) and [Option Template Records](https://tools.ietf.org/html/rfc7011#section-3.4.2). Take a look at the options below to disable the internal storage so you can use your own storing mechanism. 

Options
----
#### useInternalStorage 

Should the library not use the default internal storage strategy then set this to <b>false</b>.
Default: <b>true</b>.

When setting this field to <b>false</b> you must provide a <b>function</b> via the [templateProvider](#templateProvider) and [onNewTemplate](#onNewTemplate) options, and via [onTemplateWithdrawal](#onTemplateWithdrawal) when [transport](#transport) is "tcp" or "sctp": the deserializer throws when it is created without them.

If you dont want to switch to your own storage strategy then you can access the internal storage at any time by using the Storage property.

The internal storage is one per process, shared by every deserializer. Its templates are scoped by transport session (the session given to `deserialize`, if any), protocol version (9 or 10) and observation domain, as RFC 7011 (Observation Domain ID) and RFC 3954 (Source ID) scope them: its maps are keyed `[<session>/]<version>/<domainId>/<templateId>`, such as `10/0/256` or `192.0.2.1:4739/10/0/256`. Messages given no session share the templates of their version and domain; give each exporter's messages their session, or use <b>useInternalStorage:false</b> with [templateProvider](#templateProvider), [onNewTemplate](#onNewTemplate) and [onTemplateWithdrawal](#onTemplateWithdrawal).

A template id names one template of its domain: a template redefined as an options template, or the reverse, replaces the one stored.

```javascript
var IpfixDeserializer = require('ipfix_node')();
var storage = IpfixDeserializer.Storage;
```

#### templateProvider

Callback function to provide the decoder with the required template which is needed to deserialize the [Data Record](https://tools.ietf.org/html/rfc7011#section-3.4.3) portion found inside the binary buffer. Used together with <b>useInternalStorage:false</b> option.

You should always <b>return</b> the templates inside this function in the same format they are given to you in the [onNewTemplate](#onNewTemplate) callback function.

Function arguments: <b>templateId</b> (the id of the template which is needed by the deserializer) 

The callback is called with the deserialized packet as `this`, as [onNewTemplate](#onNewTemplate) and [onTemplateWithdrawal](#onTemplateWithdrawal) are: `this.Header.Version` (9 or 10) and `this.Header.ObservationDomainId` (IPFIX) or `this.Header.SourceId` (NetFlow v9) tell which domain's template to return. A data set whose template it does not return (`undefined` or `null`) is listed in [SkippedSets](#withdrawn-templates-and-skipped-sets); one for which it throws is listed with the error, and the rest of the message is read.

A template a message defines, or withdraws, applies to that message's later data sets and to the deserializer's next messages as soon as it is read, as RFC 7011 section 8.1 orders them: until [onNewTemplate](#onNewTemplate) or [onTemplateWithdrawal](#onTemplateWithdrawal) has settled, the deserializer keeps it pending and asks the provider for the other templates only. An asynchronous callback, such as one writing to a database, loses no data sent meanwhile.

Once the callbacks of a template id have all settled, the deserializer reads your storage again: they must take effect in the order they are called. A slower write of an earlier definition must not land after a later definition or withdrawal of the same id; chain the writes of one id, for instance.

#### onNewTemplate

Callback function which gets called whenever there are new Templates (Template Records/Option Template Records) found in the binary buffer.

!!! Its important that you define a custom callback function for this option and store the new templates found if you are using <b>useInternalStorage:false</b> option, since they are going to be needed in the following flow exports for deserializing the DataRecords and the deserializer will expect you to provide them inside <b>templateProvider</b> callback. 

Function arguments: <b>template</b>, <b>templateType</b>

- <b>template</b> format :
```json
{
  "templateId": 1024,
  "numberFields": 16,
  "setId": 2,
  "sizeInBytes": 72,
  "FieldSpecifiers": 
   [ 
     { "fieldId": 8, "fieldLength": 4 },
     { "fieldId": 12, "fieldLength": 4 },
     { "fieldId": 1, "fieldLength": 4 },
     { "fieldId": 2, "fieldLength": 4 },
     { "fieldId": 10, "fieldLength": 4 },
     { "fieldId": 14, "fieldLength": 4 },
     { "fieldId": 7, "fieldLength": 2 },
     { "fieldId": 11, "fieldLength": 2 },
     { "fieldId": 4, "fieldLength": 1 },
     { "fieldId": 6, "fieldLength": 1 },
     { "fieldId": 60, "fieldLength": 1 },
     { "fieldId": 5, "fieldLength": 1 },
     { "fieldId": 32, "fieldLength": 2 },
     { "fieldId": 58, "fieldLength": 2 },
     { "fieldId": 22, "fieldLength": 4 },
     { "fieldId": 21, "fieldLength": 4 } 
  ]
}
```

- <b>templateType</b> (string) can be "DataTemplate" or "OptionsTemplate" so you can  

A template withdrawal (a template record with a field count of 0, [RFC 7011 section 8.1](https://tools.ietf.org/html/rfc7011#section-8.1)), a template whose records would hold no byte and a template of a reserved id (255 or below) never reach this callback.

The callback is called with the deserialized packet as `this`. An error it throws, or a promise it returns that rejects, is noted as <b>error</b> on the template in <b>TemplateSets</b> or <b>OptionsTemplateSets</b>; the message is still read. Each template has a <b>settled</b> promise (not enumerable) that resolves once the callback is done: `await Promise.all(packet.TemplateSets.map(t => t.settled))`. A template the callback froze has none.

#### onTemplateWithdrawal

Callback function which gets called, with <b>useInternalStorage:false</b>, when an IPFIX exporter withdraws a Template or an Options Template ([RFC 7011 section 8.1](https://tools.ietf.org/html/rfc7011#section-8.1)): remove the template you stored for this exporter and id. A <b>templateId</b> of 2 ("DataTemplate") or 3 ("OptionsTemplate") withdraws all templates of the kind.

Withdrawals are honored only when [transport](#transport) is "tcp" or "sctp". Over UDP an exporter MUST NOT send them and a collector MUST ignore them ([RFC 7011 section 8.4](https://tools.ietf.org/html/rfc7011#section-8.4)), so the callback is never called and each withdrawal is listed in [SkippedSets](#withdrawn-templates-and-skipped-sets). A withdrawal of a template the [templateProvider](#templateProvider) does not return, or returns as the other kind (an options template has a `scopeFieldCount`), is ignored and listed too, as section 8.1 requires.

With the internal storage, the deserializer removes the template from the message's session, version and observation domain itself.

An error the callback throws, or a promise it returns that rejects, is noted as <b>error</b> on the withdrawal in <b>TemplateWithdrawals</b>; the message is still read. Each withdrawal has a <b>settled</b> promise (not enumerable) that resolves once the callback is done, so a caller can wait for an asynchronous callback's error: `await Promise.all(packet.TemplateWithdrawals.map(w => w.settled))`.

Function arguments: <b>templateId</b>, <b>templateType</b> ("DataTemplate" or "OptionsTemplate")

#### transport

The transport the messages arrive over: "udp", "tcp" or "sctp", in any case. Template withdrawals are honored over TCP and SCTP only (see [onTemplateWithdrawal](#onTemplateWithdrawal)). Any other value throws when the deserializer is created.

Default: <b>"udp"</b>

#### Withdrawn templates and skipped sets

The deserialized packet lists what it did not decode, so the caller can report it (the deserializer does not log it):

- <b>TemplateWithdrawals</b>: `{ templateId, templateType }` for each template the message withdrew, with `error` when [onTemplateWithdrawal](#onTemplateWithdrawal) failed. Always empty for NetFlow v9, which has no withdrawal, and over UDP.
- <b>SkippedSets</b>: `{ setId, templateId, reason }` for each set or template left undecoded, with `error` when the `templateProvider` threw:
  - "set shorter than its header": a set length below 4 bytes, or fewer than 4 bytes left; the rest of the message is not read.
  - "set longer than the rest of the message": the whole records of the set are read, then the message ends.
  - "record past the end of its set": a record runs past the set's end; the records before it are kept and the next set is read.
  - "unknown set id": a set that is not a template, an options template nor a data set; it is stepped over whole.
  - "template of zero-byte records": a template of no fields or of zero-length fields is not stored, and a data set of such a template, as a `templateProvider` may still return one, is not read.
  - "template of unreadable field lengths": a provider's template whose field lengths or record size are not numbers; its data set is not read.
  - "withdrawal of a reserved template id": a template record of no field whose id is 255 or below and not the set id.
  - "data set of an unknown template": a data set whose template the deserializer does not have, or the `templateProvider` does not return.
  - "template of a reserved id": a template or options template whose id is 255 or below; no data set can use it, so it is not stored.
  - "withdrawal received over UDP": a template withdrawal while [transport](#transport) is "udp"; it is ignored.
  - "withdrawal of a template not stored": a withdrawal of a template the deserializer does not have, or the `templateProvider` does not return, as a template of the withdrawal's kind; it is ignored.
  - "templateProvider failed": the `templateProvider` threw for a data set's or a withdrawal's template; the set or withdrawal is not read.
  - "message length other than its bytes": an IPFIX header's Length is not the number of bytes given; the sets up to the Length are read (all of the bytes when the Length is past them or inside the header). The entry has no set id, and gives `messageLength` and `bytes`.

  A set may end with zero padding shorter than its shortest record ([RFC 7011 section 3.3.1](https://tools.ietf.org/html/rfc7011#section-3.3.1)): it is not a record, and not listed.

#### Upgrading from 1.x

- The internal storage's maps are keyed `[<session>/]<version>/<domainId>/<templateId>` (a string), no longer by the template id.
- Template withdrawals are ignored unless [transport](#transport) is "tcp" or "sctp".
- `templateProvider` is called with the packet as `this`, and an error it throws no longer rejects the message.
- An unknown `transport`, or <b>useInternalStorage:false</b> without `onNewTemplate` and `templateProvider`, throws when the deserializer is created.
- An IPFIX message is read up to its header's Length, not to the end of the buffer.
- An error in `onNewTemplate` no longer rejects the message: it is noted on the template.
- The deserializer no longer logs a missing template, a record cut short or an unreadable data set: each is listed in <b>SkippedSets</b>.

#### parseDataValues

Boolean option which tells the deserializer whether it should detect and parse values inside Data Records automatically or it should return raw UINT data instead.

Default: <b>true</b>
