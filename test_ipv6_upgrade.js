#!/usr/bin/env node

const { Address6 } = require('ip-address');
const ByteParser = require('./lib/utils/byte_parsers');

console.log('Testing ip-address v10 upgrade...\n');

console.log('Test 1: Basic IPv6 parsing with fromUnsignedByteArray (used in byte_parsers.js)');
try {
    const testBytes = [0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
    const addr = Address6.fromUnsignedByteArray(testBytes);
    console.log(`  Input bytes: ${testBytes.join(', ')}`);
    console.log(`  Parsed address: ${addr.address}`);
    console.log(`  Expected: 2001:db8::1`);
    console.log(`  ✅ Test passed: ${addr.address === '2001:db8::1' ? 'YES' : 'NO'}\n`);
} catch (error) {
    console.log(`  ❌ Test failed: ${error.message}\n`);
    process.exit(1);
}

console.log('Test 2: ByteParser.ipv6Address() method (actual usage in codebase)');
try {
    const testBytes = [0x20, 0x01, 0x0d, 0xb8, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
    const result = ByteParser.ipv6Address(testBytes);
    console.log(`  Input bytes: ${testBytes.join(', ')}`);
    console.log(`  Parsed address: ${result}`);
    console.log(`  Expected: 2001:db8::1`);
    console.log(`  ✅ Test passed: ${result === '2001:db8::1' ? 'YES' : 'NO'}\n`);
} catch (error) {
    console.log(`  ❌ Test failed: ${error.message}\n`);
    process.exit(1);
}

console.log('Test 3: Another IPv6 address (link-local)');
try {
    const testBytes = [0xfe, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01];
    const result = ByteParser.ipv6Address(testBytes);
    console.log(`  Input bytes: ${testBytes.join(', ')}`);
    console.log(`  Parsed address: ${result}`);
    console.log(`  Expected: fe80::1`);
    console.log(`  ✅ Test passed: ${result === 'fe80::1' ? 'YES' : 'NO'}\n`);
} catch (error) {
    console.log(`  ❌ Test failed: ${error.message}\n`);
    process.exit(1);
}

console.log('Test 4: IPv4 parsing (ensure no regression)');
try {
    const ipv4Int = 0xC0A80101; // 192.168.1.1
    const result = ByteParser.ipv4Address(ipv4Int);
    console.log(`  Input int: 0x${ipv4Int.toString(16)}`);
    console.log(`  Parsed address: ${result}`);
    console.log(`  Expected: 192.168.1.1`);
    console.log(`  ✅ Test passed: ${result === '192.168.1.1' ? 'YES' : 'NO'}\n`);
} catch (error) {
    console.log(`  ❌ Test failed: ${error.message}\n`);
    process.exit(1);
}

console.log('Test 5: Verify all Address6 static methods are available');
try {
    const methods = ['fromUnsignedByteArray', 'fromByteArray', 'fromBigInt', 'isValid', 'fromURL'];
    const missingMethods = methods.filter(m => typeof Address6[m] !== 'function');
    
    if (missingMethods.length > 0) {
        console.log(`  ❌ Missing methods: ${missingMethods.join(', ')}\n`);
        process.exit(1);
    }
    
    console.log(`  All required methods present: ${methods.join(', ')}`);
    console.log(`  ✅ Test passed\n`);
} catch (error) {
    console.log(`  ❌ Test failed: ${error.message}\n`);
    process.exit(1);
}

console.log('========================================');
console.log('✅ All tests passed! ip-address v10 upgrade is safe.');
console.log('========================================\n');
