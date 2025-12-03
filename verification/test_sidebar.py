from playwright.sync_api import sync_playwright

def verify_app():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Mock window.electron to avoid crash on load
        # We need to make sure we inject this BEFORE any other script runs
        page.add_init_script("""
            window.electron = {
                ipcRenderer: {
                    invoke: async (channel) => {
                         if (channel === 'get-all-samples') {
                            return [
                                { name: 'Kick 1', path: '/a/b/k1.wav', library: 'Drums', category: 'Kick' },
                                { name: 'Bass 1', path: '/a/b/b1.wav', library: 'Bass', category: 'Bass' }
                            ]
                        }
                        return []
                    },
                    send: () => {}
                }
            }
        """)

        try:
            # Navigate to the static build
            page.goto("http://localhost:8080")

            # Wait for content
            page.wait_for_selector("text=Drums", timeout=5000)

            # Hover over "Drums" library to see the Plus button
            page.hover("text=Drums")

            # Take screenshot
            page.screenshot(path="verification/sidebar_test.png")
            print("Screenshot taken")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_app()
