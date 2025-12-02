from playwright.sync_api import sync_playwright

def verify_updates():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Mock window.electron before loading the page
        page.add_init_script("""
            window.electron = {
                ipcRenderer: {
                    invoke: async (channel, args) => {
                        if (channel === 'get-all-samples') {
                            const samples = [];
                            // Generate 60 samples to test pagination
                            for (let i = 1; i <= 60; i++) {
                                samples.push({
                                    _id: i.toString(),
                                    name: `Sample_${i}.wav`,
                                    path: `/audio/Sample_${i}.wav`,
                                    library: 'Test Lib',
                                    category: i % 2 === 0 ? 'Kick' : 'Snare',
                                    bpm: 120 + i,
                                    key: 'C'
                                });
                            }
                            return samples;
                        }
                        return [];
                    },
                    send: (channel, args) => {}
                }
            };
        """)

        try:
            # Navigate to the renderer dev server (assumed running from previous step)
            page.goto("http://localhost:5173")
            
            # 1. Verify Title Change
            page.wait_for_selector("text=Soundstarter")
            
            # 2. Verify Filters UI (Click Filter toggle)
            # Sometimes the click might not work if element is animating or obstructed?
            # Let's force click or check visibility logic.
            # In App.jsx, showFilters default is true? No, default was `useState(true)` in my change.
            # So filters should be visible by default.
            
            page.wait_for_selector("text=Categoría", timeout=5000)
            
            # 3. Verify Pagination
            load_more_btn = page.locator("button:has-text('Cargar más')")
            if load_more_btn.is_visible():
                print("Pagination 'Load More' button found.")
            else:
                print("Pagination button NOT found.")

            # Take screenshot of the new UI with filters open
            page.screenshot(path="verification/updated_ui.png")
            print("Screenshot taken successfully")
            
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_state.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_updates()
