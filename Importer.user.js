// ==UserScript==
// @name         LivePhish to MusicBrainz Importer
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a button to LivePhish show pages to seed the MusicBrainz Release Editor via POST.
// @author       GamersCorp
// @match        https://*.livephish.com/browse/music/phish/*
// @match        https://www.livephish.com/LP-*.html*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @icon         https://www.google.com/s2/favicons?sz=64&domain=musicbrainz.org
// ==/UserScript==

(function() {
    'use strict';

    // --- Constants ---
    const PHISH_MBID = 'e01646f2-2a04-450d-8bf2-0d993082e058';
    const MUSICBRAINZ_ADD_URL = 'https://musicbrainz.org/release/add';
    const BUTTON_TEXT = 'Seed MusicBrainz Release';
    const LP_PAGE_TIMEOUT = 25000;
    const BROWSE_PAGE_TIMEOUT = 15000;
    const ARTIST_NAME = "Phish"; // Hardcoded artist name
    const LABEL_NAME = "LivePhish.com"; // Changed Label Name
    const MONTH_MAP = { // Mapping for month names to numbers
        'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
        'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
    };


    // --- Styling for the Button ---
    GM_addStyle(`
        .mb-import-button {
            background-color: #f7941e; /* MusicBrainz Orange */
            color: white;
            border: none;
            padding: 8px 15px;
            margin: 10px 0 10px 0; /* Margin for block display */
            border-radius: 5px;
            cursor: pointer;
            font-size: 1em;
            font-weight: bold;
            transition: background-color 0.3s ease;
            display: block; /* Default to block */
            width: fit-content;
        }
        .mb-import-button:hover {
            background-color: #e68a0d;
        }
        /* Adjust title alignment if needed */
        .show-details h2 {
             display: inline-block;
             vertical-align: middle;
             margin-bottom: 0;
        }
         /* Style for browse page button (override display) */
         .show-details .mb-import-button {
             display: inline-block;
             margin-left: 10px; /* Add left margin */
             vertical-align: middle;
         }

        /* Ensure venue/date divs are block for spacing */
        div.venue, div.performance-date {
            display: block;
            margin-bottom: 10px;
        }
        /* Styling for tracks */
        .product-set-item { /* Style potential track row divs */
            padding: 3px 0;
            border-bottom: 1px solid #eee; /* Add separator */
            display: flex; /* Use flexbox for alignment */
            justify-content: space-between; /* Push time to the right */
            align-items: center;
        }
         .product-set-item:last-child {
             border-bottom: none; /* Remove border from last track */
         }
         .item-name-time-wrapper { /* Container for name and maybe other details */
            flex-grow: 1; /* Allow name container to take up space */
            margin-right: 10px; /* Space between name and time */
         }
         span.item-name {
            font-weight: bold;
         }
         /* Target the new time selector */
         span.runningTime.smallest.steel {
             color: #555;
             white-space: nowrap; /* Prevent time from wrapping */
         }

    `);

    // --- Helper Functions ---

    /**
     * Converts duration string (MM:SS or HH:MM:SS) to milliseconds.
     */
    function durationToMs(durationStr) {
        if (!durationStr) return '';
        const cleanedDurationStr = durationStr.trim().replace(/[()]/g, '');
        const parts = cleanedDurationStr.split(/[:.]/);
        if (parts.length < 2 || parts.length > 3) return '';
        try {
            let hours = 0, minutes = 0, seconds = 0;
            if (parts.length === 3) {
                 hours = parseInt(parts[0], 10); minutes = parseInt(parts[1], 10); seconds = parseInt(parts[2], 10);
            } else {
                 minutes = parseInt(parts[0], 10); seconds = parseInt(parts[1], 10);
            }
            if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return '';
            return ((hours * 3600) + (minutes * 60) + seconds) * 1000;
        } catch (e) { console.error("MB Import Error parsing duration:", durationStr, e); return ''; }
    }

    /**
     * Formats a date object into YYYY-MM-DD.
     */
    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Parses a date string (handles MM/DD/YYYY and MMM DD, YYYY formats).
     * Returns object { year, month, day } with month/day as strings 'MM', 'DD'.
     */
    function parseDateString(dateString) {
        if (!dateString) return null;
        dateString = dateString.trim();
        // Try MM/DD/YYYY
        const numericDateRegex = /^(?<month>\d{1,2})\/(?<day>\d{1,2})\/(?<year>\d{4})$/;
        let match = dateString.match(numericDateRegex);
        if (match && match.groups) {
            return {
                year: match.groups.year,
                month: match.groups.month.padStart(2, '0'),
                day: match.groups.day.padStart(2, '0')
            };
        }
        // Try MMM DD, YYYY
        const monthDayYearRegex = /^(?<monthName>[A-Za-z]{3})\s+(?<day>\d{1,2}),?\s+(?<year>\d{4})$/;
        match = dateString.match(monthDayYearRegex);
        if (match && match.groups) {
            const monthNum = MONTH_MAP[match.groups.monthName];
            if (monthNum) {
                return {
                    year: match.groups.year,
                    month: monthNum, // Already padded '01'-'12'
                    day: match.groups.day.padStart(2, '0')
                };
            } else {
                console.error(`MB Import: Unknown month name "${match.groups.monthName}" in date string: "${dateString}"`);
            }
        }
        console.error(`MB Import: Could not parse date string with known formats: "${dateString}"`);
        return null;
    }


    /**
     * Waits for an element to appear in the DOM.
     */
    function waitForElement(selector, context = document, interval = 500, timeout = 15000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timer = setInterval(() => {
                const elements = context.querySelectorAll(selector);
                if (elements.length > 0) { clearInterval(timer); resolve(elements[0]); }
                else if (Date.now() - startTime > timeout) {
                    clearInterval(timer);
                    const contextIdentifier = context === document ? 'document' : `${context.tagName}${context.id ? '#' + context.id : ''}${context.className ? '.' + context.className.split(' ').join('.') : ''}`;
                    console.error(`MB Import: Timeout waiting for "${selector}" within ${contextIdentifier}`);
                    reject(new Error(`Element "${selector}" not found within ${contextIdentifier} after ${timeout}ms`));
                }
            }, interval);
        });
    }

    /**
     * Creates a hidden input element for a form.
     */
     function createHiddenInput(name, value) {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        return input;
     }

    // --- Main Script Logic ---

    async function main() {
        try {
            // --- Determine Page Type and Selectors ---
            let titleBrowseSelector, dateSelector, venueSelector, tracksContainerSelector, setContainerSelector, setNameSelector, trackRowSelector, trackNameSelector, trackTimeSelector;
            let buttonInsertionReferenceElement;
            let waitTimeout;

            const isBrowsePage = window.location.pathname.includes('/browse/music/phish/');
            const isLPPage = window.location.hostname === 'www.livephish.com' && window.location.pathname.match(/^\/LP-\d+\.html$/);

            let browseTitleElement = null, dateElement = null, venueElement = null, tracksContainer = null;

            if (isBrowsePage) {
                console.log("MB Import: Detected Browse Page");
                const pageContainerSelector = 'div.show-details';
                titleBrowseSelector = 'h2';
                dateSelector = null; venueSelector = null;
                tracksContainerSelector = 'div#tracks-tab';
                setContainerSelector = 'div.set-container';
                setNameSelector = 'h3';
                trackRowSelector = 'table.tracklist tbody tr';
                trackNameSelector = 'td.trackName';
                trackTimeSelector = 'td.trackTime';
                waitTimeout = BROWSE_PAGE_TIMEOUT;

                const pageContainer = await waitForElement(pageContainerSelector, document, 500, waitTimeout);
                browseTitleElement = await waitForElement(titleBrowseSelector, pageContainer);
                tracksContainer = await waitForElement(tracksContainerSelector);
                await waitForElement(trackRowSelector, tracksContainer);
                buttonInsertionReferenceElement = browseTitleElement;

            } else if (isLPPage) {
                console.log("MB Import: Detected LP Page");
                dateSelector = 'div.performance-date';
                venueSelector = 'div.venue';
                tracksContainerSelector = 'div.product-set-list';
                setContainerSelector = 'div.product-set-container';
                setNameSelector = 'h4';
                trackRowSelector = 'div.product-set-item';
                trackNameSelector = 'span.item-name';
                trackTimeSelector = 'span.runningTime.smallest.steel';
                waitTimeout = LP_PAGE_TIMEOUT;

                console.log(`MB Import: Waiting concurrently for date, venue, and tracks container (Timeout: ${waitTimeout}ms)`);
                [dateElement, venueElement, tracksContainer] = await Promise.all([
                    waitForElement(dateSelector, document, 500, waitTimeout),
                    waitForElement(venueSelector, document, 500, waitTimeout),
                    waitForElement(tracksContainerSelector, document, 500, waitTimeout)
                ]);
                 console.log("MB Import: Found Date Element:", dateElement);
                 console.log("MB Import: Found Venue Element:", venueElement);
                 console.log("MB Import: Found Tracks Container:", tracksContainer);

                await waitForElement(trackRowSelector, tracksContainer, 500, 5000);
                buttonInsertionReferenceElement = venueElement;

            } else {
                console.warn("MB Import: Page type not recognized. URL:", window.location.href);
                return;
            }

             if ((isBrowsePage && !browseTitleElement) || (isLPPage && (!dateElement || !venueElement)) || !tracksContainer) {
                 throw new Error("One or more essential page elements could not be found.");
             }
            console.log("MB Import: All essential elements located.");

            // --- Create and Insert Button ---
            const importButton = document.createElement('button');
            importButton.textContent = BUTTON_TEXT;
            importButton.className = 'mb-import-button';

            importButton.addEventListener('click', () => handleImportClick(
                browseTitleElement, dateElement, venueElement, tracksContainer,
                setContainerSelector, setNameSelector, trackRowSelector,
                trackNameSelector, trackTimeSelector, isLPPage, isBrowsePage
            ));

            buttonInsertionReferenceElement.parentNode.insertBefore(importButton, buttonInsertionReferenceElement.nextSibling);
            console.log("MB Import: Button added to page.");

        } catch (error) {
            console.error("LivePhish to MB Importer Error (Setup):", error);
            const errorMsg = error.message.includes("not found within")
               ? `Could not find essential element (${error.message.split('"')[1]}). Page structure might have changed.`
               : error.message;
            alert("LivePhish Importer Error: Could not initialize script.\n\nDetails: " + errorMsg);
        }
    }

    // --- Button Click Handler ---
    function handleImportClick(
        browseTitleElement, dateElement, venueElement, tracksContainer,
        setContainerSelector, setNameSelector, trackRowSelector,
        trackNameSelector, trackTimeSelector, isLPPage, isBrowsePage
    ) {
        console.log("MB Import: Import button clicked!");
        try {
            // --- Scrape Basic Release Data ---
            let parsedDate, venue, city, state; // Use parsedDate object
            const artist = ARTIST_NAME;

            if (isBrowsePage) {
                 if (!browseTitleElement) throw new Error("Browse title element was not passed correctly.");
                 const titleText = browseTitleElement.textContent.trim();
                 parsedDate = parseDateString(titleText); // Get {year, month, day}
                 if (!parsedDate) throw new Error(`Could not parse date from browse page title: "${titleText}"`);
                 const browseVenueRegex = /-\s*(?<venue>.+?)\s*-\s*(?<city>[^,]+?),\s*(?<state>[A-Z]{2}(?:\s+[A-Z]{2})?)$/i;
                 const venueMatch = titleText.match(browseVenueRegex);
                 if (venueMatch && venueMatch.groups) {
                     venue = venueMatch.groups.venue.trim();
                     city = venueMatch.groups.city.trim();
                     state = venueMatch.groups.state.trim();
                 } else { venue = "Unknown Venue"; city = "Unknown"; state = "Unknown"; }

            } else if (isLPPage) {
                if (!dateElement) throw new Error("Date element was not passed correctly for LP page.");
                const dateText = dateElement.textContent.trim();
                parsedDate = parseDateString(dateText); // Get {year, month, day}
                if (!parsedDate) throw new Error(`Could not parse date from element: "${dateText}"`);

                if (!venueElement) throw new Error("Venue element was not passed correctly for LP page.");
                let venueText = venueElement.textContent.trim();
                venueText = venueText.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ');
                const venueRegex = /^(?<venue>.+?),\s*(?<city>[^,]+?),\s*(?<state>[A-Z]{2}(?:\s+[A-Z]{2})?)$/i;
                const venueMatch = venueText.match(venueRegex);
                 if (!venueMatch || !venueMatch.groups) {
                     venue = venueText; city = "Unknown"; state = "Unknown";
                 } else {
                    ({ venue, city, state } = venueMatch.groups);
                    venue = venue.trim(); city = city.trim(); state = state.trim();
                 }
            } else {
                 throw new Error("Could not determine page type for parsing.");
            }

            // --- Construct MB Title/Disambiguation ---
            if (!parsedDate) throw new Error("Failed to parse date components.");
            // Use parsed components directly for title/comment
            const releaseDateForTitle = `${parsedDate.year}-${parsedDate.month}-${parsedDate.day}`;
            // *** ADDED colon to title format ***
            let mbReleaseTitle = `${releaseDateForTitle}: ${venue}`;
            if (city !== "Unknown" && state !== "Unknown") mbReleaseTitle += `, ${city}, ${state}`;
            // Disambiguation is no longer sent, but keep variable for logging
            const disambiguation = `Live at ${venue}, ${releaseDateForTitle}`;
            const countryCode = 'US';
            const label = LABEL_NAME; // Use constant for label name
            console.log("MB Import: MB Release Title:", mbReleaseTitle);
            console.log("MB Import: MB Disambiguation (not sent):", disambiguation);

            // --- Scrape Tracklist Data ---
            console.log("MB Import: Scraping tracklist from container:", tracksContainer);
            const mediumsData = [];
            if (!tracksContainer) throw new Error("Tracks container element was not passed correctly.");

            let setContainers;
            if (setContainerSelector) {
                 setContainers = tracksContainer.querySelectorAll(setContainerSelector);
            }

            if (!setContainers || setContainers.length === 0) {
                console.warn(`MB Import: No specific set containers found using "${setContainerSelector}". Treating track container as single medium.`);
                setContainers = [tracksContainer]; setNameSelector = null;
            } else {
                 console.log(`MB Import: Found ${setContainers.length} set containers using selector "${setContainerSelector}".`);
            }

            setContainers.forEach((setContainer, mediumIndex) => {
                let setName = '';
                if (setNameSelector) {
                    const nameElement = setContainer.querySelector(`:scope > ${setNameSelector}`);
                    if (nameElement) setName = nameElement.textContent.trim().replace(/:$/, '') || setName;
                 }
                 if (setContainers.length > 1 && setName === '') setName = `Set ${mediumIndex + 1}`;
                 else if (setContainers.length === 1 && setName === '') setName = '';

                console.log(`MB Import: Processing Medium ${mediumIndex + 1} (Name: '${setName || "Disc 1"}')`);
                const currentMedium = { name: setName || `Disc ${mediumIndex + 1}`, tracks: [] };
                const trackRows = setContainer.querySelectorAll(trackRowSelector);

                if (!trackRows || trackRows.length === 0) {
                     console.warn(`MB Import: No track rows found for Medium ${mediumIndex + 1} using selector: "${trackRowSelector}" within set container:`, setContainer);
                     return;
                 }
                 console.log(`MB Import: Found ${trackRows.length} potential track rows for Medium ${mediumIndex + 1}.`);

                trackRows.forEach((row, trackIndex) => {
                    const titleElem = row.querySelector(trackNameSelector);
                    const durationElem = row.querySelector(trackTimeSelector);
                    let trackTitle = null, cleanedTrackTitle = null, trackDurationStr = null, trackLengthMs = null;

                    if (titleElem) {
                        trackTitle = titleElem.textContent.trim();
                        cleanedTrackTitle = trackTitle.replace(/^\d+\.?\s+/, '');
                    } else {
                        console.warn(`MB Import: Row ${trackIndex + 1}: Title element ('${trackNameSelector}') NOT FOUND within:`, row);
                    }

                    if (durationElem) {
                        trackDurationStr = durationElem.textContent.trim();
                        trackLengthMs = durationToMs(trackDurationStr);
                    } else {
                        console.warn(`MB Import: Row ${trackIndex + 1}: Duration element ('${trackTimeSelector}') NOT FOUND within:`, row);
                    }

                    if (cleanedTrackTitle && trackLengthMs) {
                        currentMedium.tracks.push({ title: cleanedTrackTitle, length: trackLengthMs });
                    }
                });

                 if (currentMedium.tracks.length > 0) {
                     mediumsData.push(currentMedium);
                     console.log(`MB Import: Added Medium ${mediumIndex + 1} data with ${currentMedium.tracks.length} tracks.`);
                 }
                 else console.warn(`MB Import: No valid tracks found for Medium ${mediumIndex + 1} (Name: ${setName})`);
            });

             if (mediumsData.length === 0) throw new Error("Failed to scrape any valid tracks.");
             console.log(`MB Import: Successfully scraped data for ${mediumsData.length} medium(s).`);

            // --- Create Form for POST Seeding ---
            console.log("MB Import: Creating POST form for MusicBrainz seeding...");
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = MUSICBRAINZ_ADD_URL;
            form.target = '_blank'; // Open in new tab
            form.style.display = 'none'; // Hide the form

            // Add basic release info
            form.appendChild(createHiddenInput('name', mbReleaseTitle)); // Release Title (Updated Format)
            form.appendChild(createHiddenInput('status', 'Official'));
            form.appendChild(createHiddenInput('type', 'Album')); // Add Type: Album
            form.appendChild(createHiddenInput('type', 'Live')); // Add Type: Live
            form.appendChild(createHiddenInput('language', 'eng'));
            form.appendChild(createHiddenInput('script', 'Latn'));
            // *** REMOVED comment parameter ***
            // form.appendChild(createHiddenInput('comment', disambiguation));

            // Add Artist Credit
            form.appendChild(createHiddenInput('artist_credit.names.0.mbid', PHISH_MBID));
            form.appendChild(createHiddenInput('artist_credit.names.0.name', artist));

            // Add Release Event Info
            form.appendChild(createHiddenInput('events.0.date.year', parsedDate.year));
            form.appendChild(createHiddenInput('events.0.date.month', parsedDate.month));
            form.appendChild(createHiddenInput('events.0.date.day', parsedDate.day));
            form.appendChild(createHiddenInput('events.0.country', countryCode));

            // Add Label Info
            form.appendChild(createHiddenInput('labels.0.name', label)); // Use updated LABEL_NAME

            // Add medium and track info
            mediumsData.forEach((medium, mediumIndex) => {
                form.appendChild(createHiddenInput(`mediums.${mediumIndex}.format`, 'Digital Media'));
                if (medium.name) {
                    form.appendChild(createHiddenInput(`mediums.${mediumIndex}.name`, medium.name));
                }
                medium.tracks.forEach((track, trackIndex) => {
                    form.appendChild(createHiddenInput(`mediums.${mediumIndex}.track.${trackIndex}.number`, trackIndex + 1));
                    form.appendChild(createHiddenInput(`mediums.${mediumIndex}.track.${trackIndex}.name`, track.title));
                    form.appendChild(createHiddenInput(`mediums.${mediumIndex}.track.${trackIndex}.length`, track.length));
                });
            });

            // --- Submit the Form ---
            document.body.appendChild(form); // Add form to page to allow submission
            console.log("MB Import: Submitting form...");
            form.submit();
            document.body.removeChild(form); // Clean up the form
            console.log("MB Import: Form submitted.");


        } catch (error) {
            console.error("MB Import: Error during import process:", error);
            alert(`Error seeding MusicBrainz: ${error.message}\nCheck the browser console for more details.`);
        }
    }

    // --- Run the script ---
    console.log("MB Import: Script starting (v2.21)...");
    if (document.readyState === 'loading') {
         console.log("MB Import: DOM not ready, adding listener.");
        document.addEventListener('DOMContentLoaded', main);
    } else {
         console.log("MB Import: DOM ready, running main().");
        main();
    }

})();
