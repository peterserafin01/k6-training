/**
 * How to run
 * k6 run test/iwant-iphone-scenario.js
 */
import http from "k6/http";
import { group, sleep, check } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = "https://www.iwant.cz";
const searchDuration = new Trend("search_duration");
const detailDuration = new Trend("detail_duration");

// Returns a function that checks whether the response has the expected HTTP status code
function hasStatus(expectedStatus) {
  return function (response) {
    return response.status === expectedStatus;
  };
}

const isStatus200 = hasStatus(200);

// Counts the number of product list items in the HTML response body
function countProductListItems(body) {
  const matches = String(body).match(/class="productList-item"/g);
  return matches ? matches.length : 0;
}

// Counts the number of numeric pagination buttons in the HTML response body
function countPaginationButtons(body) {
  const matches = String(body).match(/>\s*\d+\s*</g);
  return matches ? matches.length : 0;
}

// Checks whether the page body contains the mobile product title element with the expected title text
function containsDetailMobileTitle(body, title) {
  const html = String(body);
  return html.includes("detail-title-mobile") && html.includes(String(title));
}

// Sends a batch of requests to load all data needed for a product detail page
function loadDetailProduct(productId) {
  return http.batch([
    [
      "POST",
      `${BASE_URL}/Products/Detail/SavePageVisit`,
      { id: String(productId) },
    ],
    [
      "GET",
      `${BASE_URL}/Orders/Inbank/GetMinRentalPriceByProductId/?productId=${productId}`,
      null,
    ],
    [
      "GET",
      `${BASE_URL}/Products/Detail/ProductDescription?id=${productId}&cg=2&it=&type=popis&buyoutCategoryId=null`,
      null,
    ],
  ]);
}

export const options = {
  vus: 2,
  duration: "5m",
  thresholds: {
    // Every request must be processed within 1000 ms
    http_req_duration: ["max<1000"],
    // Most checks must pass
    checks: ["rate>0.95"],
    // iPhone search must not take longer than 1300 ms
    search_duration: ["max<1300"],
    "http_req_duration{name:autosuggest_iphone17}": ["max<1000"],
    "http_req_duration{name:search_result_items}": ["max<1300"],
    // iPhone detail page must be displayed within 1500 ms
    detail_duration: ["max<1500"],
  },
};

export default function () {
  group("01 - Homepage", function () {
    // Load the homepage and verify it responds correctly
    const res = http.get(`${BASE_URL}/`);
    check(res, {
      "Homepage returns 200": isStatus200,
      "Homepage contains expected text": (r) =>
        r.body.includes("Jsme iWant Apple Premium Partner."),
    });
  });

  group("02 - Autosuggest", function () {
    const res = http.get(
      `${BASE_URL}/Products/Fulltext/AutocompleteItems?query=xxxxxxxxxx`,
    );
    check(res, {
      "Autosuggest returns 200": isStatus200,
    });
    sleep(1);

    // fill search input with "iphone"
    const response = http.get(
      `${BASE_URL}/Products/Fulltext/AutocompleteItems?query=iphone%2017`,
    );
    check(response, {
      "Search returns 200": isStatus200,
      "Autosuggest returns more than 10 iPhones": () =>
        response.json().length > 10,
    });
    sleep(1);
  });

  group("03 - Search", function () {
    // submit search form with "iphone 17"
    const [
      searchPageResponse,
      attributeFiltersResponse,
      searchResultsResponse,
      allFiltersResponse,
    ] = http.batch([
      ["GET", `${BASE_URL}/Vyhledavani?query=iphone`],
      [
        "GET",
        `${BASE_URL}/Products/Filter/AllAttributeFilterData?categoryId=null`,
      ],
      [
        "GET",
        `${BASE_URL}/Products/Fulltext/SearchResultItems?ftQuery=iphone%2017&ctx=101&itId=&cg=2&paramJson=`,
        null,
        { tags: { name: "search_result_items" } },
      ],
      ["GET", `${BASE_URL}/Products/Filter/AllFilterData`],
    ]);

    const productItemsCount = countProductListItems(searchResultsResponse.body);
    searchDuration.add(searchResultsResponse.timings.duration);

    check(searchPageResponse, {
      "Search page returns 200": isStatus200,
    });

    check(attributeFiltersResponse, {
      "AllAttributeFilterData returns 200": isStatus200,
    });

    check(allFiltersResponse, {
      "AllFilterData returns 200": isStatus200,
    });

    check(searchResultsResponse, {
      "SearchResultItems returns 200": isStatus200,
      "Search page contains 12 productList items": () =>
        productItemsCount === 12,
    });
    sleep(1);
  });

  group("04 - Pagination", function () {
    // Request the pagination component for a result set of 1329 items, page size 12, on page 1
    const res = http.get(
      `${BASE_URL}/Products/Helper/Pager?totalCount=1329&pageSize=12&currentPage=1&allPages=false`,
    );
    const paginationButtonsCount = countPaginationButtons(res.body);

    check(res, {
      "Pagination returns 200": isStatus200,
      "Pagination returns page buttons": () => paginationButtonsCount > 1,
      "Pagination contains next page button": (r) =>
        r.body.includes("Zobrazit další produkty") || r.body.includes(">2<"),
    });

    sleep(1);
  });

  group("05 - Detail iPhone 512GB", function () {
    // Load the 512GB product detail page and all supporting API requests in parallel
    const detailUrl = `${BASE_URL}/Apple-iPhone-17-512GB-bily-p192824`;
    const res = http.get(detailUrl);
    const [savePageVisitRes, rentalPriceRes, descriptionRes] =
      loadDetailProduct(192824);

    detailDuration.add(res.timings.duration);

    check(res, {
      "Detail iPhone 512GB returns 200": isStatus200,
      "Detail iPhone 512GB opens correct URL": (r) =>
        String(r.url).includes("Apple-iPhone-17-512GB-bily-p192824"),
      "Detail iPhone 512GB contains mobile title": (r) =>
        containsDetailMobileTitle(r.body, "Apple iPhone 17 512GB"),
    });

    check(savePageVisitRes, {
      "SavePageVisit 512GB returns 200": isStatus200,
    });

    check(rentalPriceRes, {
      "Rental price 512GB returns 200": isStatus200,
    });

    check(descriptionRes, {
      "Detail iPhone 512GB description returns 200": isStatus200,
    });

    sleep(1);
  });

  group("06 - Change storage size to 256 GB", function () {
    // Simulate user switching to the 256 GB variant on the product detail page
    const detailUrl = `${BASE_URL}/Apple-iPhone-17-256GB-bily-p192823`;
    const res = http.get(detailUrl);
    const [savePageVisitRes, rentalPriceRes, descriptionRes] =
      loadDetailProduct(192823);

    detailDuration.add(res.timings.duration);

    check(res, {
      "Detail iPhone 256GB returns 200": isStatus200,
      "Detail iPhone 256GB opens correct URL": (r) =>
        String(r.url).includes("Apple-iPhone-17-256GB-bily-p192823"),
      "Detail iPhone 256GB contains mobile title": (r) =>
        containsDetailMobileTitle(r.body, "Apple iPhone 17 256GB"),
    });

    check(savePageVisitRes, {
      "SavePageVisit 256GB returns 200": isStatus200,
    });

    check(rentalPriceRes, {
      "Rental price 256GB returns 200": isStatus200,
    });

    check(descriptionRes, {
      "Detail iPhone 256GB description returns 200": isStatus200,
    });

    sleep(1);
  });
}
