
// DOM Elements
const form = document.getElementById('bookingForm');
const bookingDateInput = document.getElementById('bookingDate');
const startTimeSelect = document.getElementById('startTime');
const endTimeSelect = document.getElementById('endTime');
const numberOfBoardsInput = document.getElementById('numberOfBoards');
const totalPriceDisplay = document.getElementById('totalPrice');
const submitBtn = document.getElementById('submitBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const dayRateMessage = document.getElementById('dayRateMessage');

// Booking hours: 8:00 - 20:00 (in 30-minute intervals)
const BOOKING_START_HOUR = 8;
const BOOKING_END_HOUR = 20;

// Generate time options (8:00 to 19:45 in 15-minute intervals)
function generateTimeOptions() {
    const options = [];
    for (let hour = BOOKING_START_HOUR; hour < BOOKING_END_HOUR; hour++) {
        for (let minute = 0; minute < 60; minute += 15) {
            const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
            options.push(`<option value="${timeString}">${timeString} Uhr</option>`);
        }
    }
    return options.join('');
}

// Populate time selects
startTimeSelect.innerHTML = '<option value="">Bitte wählen</option>' + generateTimeOptions();
endTimeSelect.innerHTML = '<option value="">Bitte wählen</option>' + generateTimeOptions();

// Set minimum date to today
const today = new Date();
today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
bookingDateInput.min = today.toISOString().slice(0, 10);

// Update end time options when start time changes (only show times after start time)
startTimeSelect.addEventListener('change', () => {
    if (startTimeSelect.value) {
        const startTime = startTimeSelect.value;
        const [startHour, startMinute] = startTime.split(':').map(Number);
        
        // Regenerate end time options, filtering out times before start time
        let endOptions = '<option value="">Bitte wählen</option>';
        for (let hour = BOOKING_START_HOUR; hour < BOOKING_END_HOUR; hour++) {
            for (let minute = 0; minute < 60; minute += 15) {
                if (hour > startHour || (hour === startHour && minute > startMinute)) {
                    const timeString = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
                    endOptions += `<option value="${timeString}">${timeString} Uhr</option>`;
                }
            }
        }
        endTimeSelect.innerHTML = endOptions;
        
        // Clear end time if it's now invalid
        if (endTimeSelect.value && endTimeSelect.value <= startTime) {
            endTimeSelect.value = '';
        }
        
        calculatePrice();
    } else {
        // Reset end time options if start time is cleared
        endTimeSelect.innerHTML = '<option value="">Bitte wählen</option>' + generateTimeOptions();
        calculatePrice();
    }
});

// Calculate price when inputs change
[bookingDateInput, startTimeSelect, endTimeSelect, numberOfBoardsInput].forEach(input => {
    input.addEventListener('change', calculatePrice);
});

// Calculate price function
async function calculatePrice() {
    const bookingDate = bookingDateInput.value;
    const startTime = startTimeSelect.value;
    const endTime = endTimeSelect.value;
    const numberOfBoards = parseInt(numberOfBoardsInput.value) || 1;

    if (!bookingDate || !startTime || !endTime) {
        totalPriceDisplay.textContent = '0,00 €';
        dayRateMessage.classList.add('hidden');
        return;
    }

    // Use selected date for both start and end
    const startDateTime = `${bookingDate}T${startTime}:00`;
    const endDateTime = `${bookingDate}T${endTime}:00`;

    try {
        const response = await fetch('/api/calculate-price', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                startTime: startDateTime,
                endTime: endDateTime,
                numberOfBoards
            })
        });

        const data = await response.json();
        if (data.price !== undefined) {
            totalPriceDisplay.textContent = `${data.price.toFixed(2)} €`;
            
            // Show day rate message only for 24h+ bookings
            if (data.isDayRate) {
                const dayRateDetails = document.getElementById('dayRateDetails');
                dayRateDetails.textContent = `Tagesmiete (24h) wurde aktiviert.`;
                dayRateMessage.classList.remove('hidden');
            } else {
                dayRateMessage.classList.add('hidden');
            }
        }
    } catch (error) {
        console.error('Error calculating price:', error);
    }
}

// Form submission
let isSubmitting = false;

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent double submission
    if (isSubmitting) {
        return;
    }
    
    const formData = new FormData(form);
    const paymentMethod = formData.get('paymentMethod');
    const privacyCheck = document.getElementById('privacyCheck').checked;
    const safetyCheck = document.getElementById('safetyCheck').checked;
    
    // Early validation before disabling button
    if (!privacyCheck || !safetyCheck) {
        showErrorMessage('Bitte akzeptiere die Datenschutzerklärung und bestätige, dass du den Leitfaden gelesen hast.');
        return;
    }
    
    // Get date and times for validation
    const bookingDate = formData.get('bookingDate');
    const startTime = formData.get('startTime');
    const endTime = formData.get('endTime');
    
    if (!bookingDate || !startTime || !endTime) {
        showErrorMessage('Bitte fülle alle Felder aus.');
        return;
    }
    
    // Set submitting flag
    isSubmitting = true;
    
    // Hide previous messages
    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');
    dayRateMessage.classList.add('hidden');
    
    // Disable submit button immediately
    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird verarbeitet...';
    submitBtn.style.opacity = '0.6';
    submitBtn.style.cursor = 'not-allowed';
    
    try {
        const startDateTime = `${bookingDate}T${startTime}:00`;
        const endDateTime = `${bookingDate}T${endTime}:00`;
        
        const bookingData = {
            name: formData.get('name'),
            phone: formData.get('phone'),
            numberOfBoards: parseInt(formData.get('numberOfBoards')) || 1,
            startTime: startDateTime,
            endTime: endDateTime,
            paymentMethod: paymentMethod
        };
        
        const response = await fetch('/api/bookings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bookingData)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Fehler bei der Buchung');
        }
        
        if (paymentMethod === 'paypal') {
            // PayPal payment - redirect to PayPal link
            if (data.booking.paypalLink) {
                // Create PayPal.me link with amount
                let paypalUrl = data.booking.paypalLink;
                
                // If it's a paypal.me link, add the amount
                if (paypalUrl.includes('paypal.me')) {
                    // Ensure URL format is correct
                    if (!paypalUrl.startsWith('http://') && !paypalUrl.startsWith('https://')) {
                        paypalUrl = 'https://' + paypalUrl;
                    }
                    // Format amount for PayPal.me (remove .00 if whole number)
                    const amount = parseFloat(data.booking.paypalAmount);
                    const formattedAmount = amount % 1 === 0 ? amount.toString() : amount.toFixed(2);
                    // Add amount to the link (PayPal.me format: /amount)
                    paypalUrl = `${paypalUrl}/${formattedAmount}`;
                }
                
                // Show message first with PayPal button
                showSuccessMessage(data.booking, 'paypal', true, paypalUrl);
                
                // Try to open PayPal immediately - open in new tab/window
                // Use setTimeout to ensure it's treated as user-initiated after async operation
                setTimeout(() => {
                    window.open(paypalUrl, '_blank');
                }, 0);
            } else {
                showSuccessMessage(data.booking, 'paypal', true);
            }
        } else {
            // Cash payment - show success message
            showSuccessMessage(data.booking, 'cash');
        }
    } catch (error) {
        console.error('Booking error:', error);
        showErrorMessage(error.message || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
        // Re-enable button on error
        submitBtn.disabled = false;
        submitBtn.textContent = 'Buchung abschließen';
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        isSubmitting = false;
    } finally {
        // Only reset if not showing success (success message handles reset)
        if (successMessage.classList.contains('hidden')) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Buchung abschließen';
            submitBtn.style.opacity = '1';
            submitBtn.style.cursor = 'pointer';
            isSubmitting = false;
        }
    }
});


// Show success message
function showSuccessMessage(booking, paymentMethod, needsVerification = false, paypalUrl = null) {
    let details = '';
    const paypalButton = document.getElementById('paypalLinkButton');
    
    if (paymentMethod === 'cash') {
        details = `Deine Buchung wurde erstellt! Bitte lege ${booking.price.toFixed(2)}€ in bar vor Ort in einen bereitgestellten Umschlag, beschrifte diesen mit deinem Buchungsnamen (${booking.name || 'deinem Namen'}) und lege ihn in den markierten Briefkasten.`;
        paypalButton.style.display = 'none';
    } else if (paymentMethod === 'paypal') {
        if (needsVerification) {
            details = `Deine Buchung wurde erstellt, ist aber noch nicht bestätigt! Bitte schließe die Zahlung über PayPal ab (${booking.price.toFixed(2)}€). `;
        } else {
            details = `Deine Buchung wurde erfolgreich abgeschlossen! PayPal-Zahlung: ${booking.price.toFixed(2)}€. `;
        }
        
        // Show PayPal button if URL is provided
        if (paypalUrl) {
            paypalButton.href = paypalUrl;
            paypalButton.style.display = 'inline-block';
            paypalButton.classList.remove('hidden');
            // Ensure button is clickable
            paypalButton.onclick = function(e) {
                e.preventDefault();
                window.open(paypalUrl, '_blank');
                return false;
            };
        } else {
            paypalButton.style.display = 'none';
            paypalButton.classList.add('hidden');
        }
    } else {
        details = `Deine Buchung wurde erfolgreich abgeschlossen! Zahlung erhalten: ${booking.price.toFixed(2)}€`;
        paypalButton.style.display = 'none';
    }
    
    document.getElementById('successDetails').textContent = details;
    successMessage.classList.remove('hidden');
    form.reset();
    totalPriceDisplay.textContent = '0,00 €';
    dayRateMessage.classList.add('hidden');
    
    // Reset submit button
    isSubmitting = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Buchung abschließen';
    submitBtn.style.opacity = '1';
    submitBtn.style.cursor = 'pointer';
    
    // Scroll to success message
    successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Show error message
function showErrorMessage(message) {
    document.getElementById('errorDetails').textContent = message;
    errorMessage.classList.remove('hidden');
    
    // Scroll to error message
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

