const axios = require('axios');

async function testSimplifyMore() {
  const url = 'http://localhost:4000/api/listen/simplify-more';
  const inputText = 'I am planning to go to the supermarket to buy some groceries for dinner';

  console.log(`Testing Simplify More with input: "${inputText}"`);

  try {
    const response = await axios.post(url, { text: inputText });
    console.log('Response Status:', response.status);
    console.log('Response Data:', response.data);

    if (response.data.simplified && !response.data.simplified.toLowerCase().includes('help aphasia')) {
      console.log('✅ PASS: Result seems simplified.');
    } else {
      console.log('❌ FAIL: Result is generic or missing.');
    }

  } catch (error) {
    if (error.response) {
      console.error('Error Status:', error.response.status);
      console.error('Error Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

testSimplifyMore();
