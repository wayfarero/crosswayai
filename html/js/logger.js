/**
 * Logger.js
 * Provides logging functionality for the application
 */

(function() {
  /**
   * Logs a message to the console
   * @param {string} message - The message to log
   */
  function logToOutput(message) {
    window.parent.postMessage({ type: 'LOG', message: message }, '*');
  }

  // Expose to global scope for use in other scripts
  window.logger = {
    logToOutput: logToOutput
  };
})();  
