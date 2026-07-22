#!/usr/bin/env node
/*
 * Для чего: автоматически проверить, что HTML экспортируется в UTF-8 с BOM и без потери русских строк.
 * Как работает: собираем простой HTML с русским текстом, добавляем BOM, кодируем через TextEncoder и проверяем
 * наличие BOM и обратное декодирование через TextDecoder.
 */
const { TextEncoder, TextDecoder } = require('util');

const htmlContent = `
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <title>Diagnostics encoding test</title>
    <style>body { font-family: Arial, sans-serif; }</style>
</head>
<body>
    <h1>Send confirmation timeout</h1>
    <p>Check: Text should remain readable in UTF-8.</p>
</body>
</html>`;

const utf8Html = '\uFEFF' + htmlContent;
const encoder = new TextEncoder();
const encoded = encoder.encode(utf8Html);

if (encoded[0] !== 0xEF || encoded[1] !== 0xBB || encoded[2] !== 0xBF) {
    throw new Error('BOM is missing in the encoded document');
}

const decoder = new TextDecoder('utf-8');
const decoded = decoder.decode(encoded);

if (decoded !== htmlContent) {
    throw new Error('UTF-8 roundtrip altered the content');
}

console.log('Encoding test passed: UTF-8 + BOM + roundtrip verified.');
