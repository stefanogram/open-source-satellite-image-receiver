# Satellite Image Viewer

This is a Next.js application that fetches and displays satellite images from NASA's Earth API based on user-provided coordinates and date. Future plans include integrating data from additional open-source satellite imagery providers. Your feedback and contributions are welcome!

![Example Satellite Image](screenshots/example.png)

## Features Implemented:

- Fetching satellite imagery using NASA's Earth API.
- User interface with input fields for longitude, latitude, and date.
- Displaying the fetched satellite image.
- Server-side API route for secure API key handling and request logging.
- Basic UI improvements for input fields, button, and image responsiveness.

## Getting Started

Follow these steps to get the Satellite Image Viewer application up and running on your local machine:

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    ```

    Replace `<repository-url>` with the actual URL of your GitHub repository.

2.  **Navigate to the project directory:**

    ```bash
    cd <repository-folder-name>
    ```

    Replace `<repository-folder-name>` with the name of the folder created by cloning the repository.

3.  **Install dependencies:**

    Use your preferred package manager to install the project dependencies:

    ```bash
    npm install
    # or
    yarn install
    # or
    pnpm install
    # or
    bun install
    ```

4.  **Set up environment variables:**

    Create a file named `.env` in the root of the project directory.

    You will need a NASA API key to fetch satellite images. You can obtain a free API key by following the instructions on the [NASA API website](https://api.nasa.gov/).

    Once you have your API key, add it to the `.env` file in the following format:

    ```
    NASA_API_KEY=your_api_key_here
    ```

    Replace `your_api_key_here` with the actual API key you obtained.

5.  **Run the development server:**

    ```bash
    npm run dev
    # or
    yarn dev
    # or
    pnpm dev
    # or
    bun dev
    ```

    The application will be available at [http://localhost:3001](http://localhost:3001) in your browser (Note: the port may vary if 3000 is already in use).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js)

## Deployments

You can directly run this app on your local machine or deploy it on Vercel.