from playwright.sync_api import sync_playwright

def verify_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Mock window.electron before loading the page
        page.add_init_script("""
            window.electron = {
                ipcRenderer: {
                    invoke: async (channel, args) => {
                        console.log('Invoke:', channel, args);
                        if (channel === 'get-all-samples') {
                            return [
                                { _id: '1', name: 'Kick_01.wav', path: '/audio/Kick_01.wav', library: 'Test Lib', category: 'Kick', bpm: 120, key: 'C' },
                                { _id: '2', name: 'Snare_01.wav', path: '/audio/Snare_01.wav', library: 'Test Lib', category: 'Snare', bpm: null, key: null }
                            ];
                        }
                        if (channel === 'import-content') {
                             return { folderName: 'Imported', files: [] };
                        }
                        return [];
                    },
                    send: (channel, args) => {
                        console.log('Send:', channel, args);
                    }
                }
            };
        """)

        try:
            # Navigate to the renderer dev server
            page.goto("http://localhost:5173")
            
            # Wait for content to load
            page.wait_for_selector("text=SPLICE LOCAL")
            page.wait_for_selector("text=Kick_01.wav")
            
            # Take screenshot
            page.screenshot(path="verification/app_screenshot.png")
            print("Screenshot taken successfully")
            
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_app()
