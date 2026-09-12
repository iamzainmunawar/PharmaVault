
(function () {
  "use strict";

  var ABOUT_HTML =
    '<p>Hi, I\'m Muhammad Zain Munawar, a Doctor of Pharmacy student with an interest in pharmacy, pharmaceutical sciences, healthcare technology, and the ways digital tools can make learning and working with medicines easier.</p>' +
    '<p>I started PharmaGrid from a simple idea. Pharmaceutical knowledge should not feel unnecessarily difficult to find, understand, or use.</p>' +
    '<p>As a pharmacy student, I have experienced firsthand how much information pharmacists and students have to deal with, from pharmacology and pharmaceutics to drug information, calculations, prescriptions, compatibility, and clinical concepts.</p>' +
    '<p>At the same time, technology is changing how people learn and access information. This created the idea for PharmaGrid, to combine pharmaceutical knowledge with useful digital tools in one platform.</p>' +
    '<h3>Why I Built PharmaGrid</h3>' +
    '<p>PharmaGrid is not intended to replace textbooks, official references, clinical guidelines, or healthcare professionals.</p>' +
    '<p>Instead, the goal is to create a practical digital companion that can help users learn, explore, calculate, organize, and understand pharmaceutical information more efficiently.</p>' +
    '<p>The project is also a way for me to explore the intersection of two fields that I find increasingly interesting: pharmacy and technology.</p>' +
    '<h3>The Bigger Goal</h3>' +
    '<p>I hope PharmaGrid can eventually grow from a personal project into a comprehensive pharmaceutical platform containing educational resources, drug references, pharmaceutical calculators, clinical support tools, and other useful features.</p>' +
    '<p>The project is a work in progress, and I am continuously learning while building it.</p>' +
    '<p>If you find an error, have an idea for a new feature, or simply have a suggestion about how PharmaGrid could become more useful, I would genuinely like to hear from you.</p>' +
    '<p class="signoff">Muhammad Zain Munawar<br>Founder and Developer, PharmaGrid</p>';

  var CONTACT_HTML =
    '<h3>Have a Question, Found a Mistake, or Have a Suggestion?</h3>' +
    '<p>PharmaGrid is an evolving project, and your feedback can help make it better.</p>' +
    '<p>If you have a question about the website, find an error in the information, notice something that needs correction, or have an idea for a new feature or resource, feel free to get in touch.</p>' +
    '<h3>You Can Contact Us About</h3>' +
    '<ul>' +
      '<li>Questions regarding PharmaGrid</li>' +
      '<li>Reporting incorrect or outdated information</li>' +
      '<li>Suggestions for new tools or features</li>' +
      '<li>Pharmaceutical calculators you would like to see</li>' +
      '<li>Drug information corrections</li>' +
      '<li>Website issues or broken features</li>' +
      '<li>General feedback and suggestions</li>' +
      '<li>Collaboration or project related inquiries</li>' +
    '</ul>' +
    '<h3>Email</h3>' +
    '<p><a class="mailto" href="mailto:iamzainmunawar@gmail.com">iamzainmunawar@gmail.com</a></p>' +
    '<p>We welcome genuine feedback and suggestions from students, pharmacists, healthcare professionals, developers, and visitors.</p>' +
    '<p>When reporting an error, please include the page name, relevant information, and the correction or reference if available. This helps us review and improve the content more effectively.</p>' +
    '<p class="signoff">Your feedback helps PharmaGrid grow.<br>Thank you for being part of the project.</p>';

  var DISCLAIMER_HTML =
    '<h3>Educational Use Only</h3>' +
    '<p>PharmaGrid is an independent, educational reference built by a pharmacy student. It is intended to help students and healthcare professionals study and organize pharmaceutical information more easily. It is <strong>not</strong> a substitute for professional medical or pharmacist advice, diagnosis, or treatment.</p>' +
    '<p>Do not use PharmaGrid as the sole basis for any clinical, prescribing, or patient-care decision. Always verify drug information, including dosing, indications, contraindications, and interactions, against current official references, the manufacturer packaging/leaflet, DRAP-approved prescribing information, or a qualified healthcare professional before acting on it.</p>' +
    '<h3>No Guarantee of Accuracy</h3>' +
    '<p>The information in this vault has been compiled from publicly available drug packaging, leaflets, and reference material, and organized manually and with the help of software tooling. Despite reasonable care, it may contain errors, omissions, or outdated entries, and brand availability, formulations, and manufacturers can change over time.</p>' +
    '<p>PharmaGrid and its developer make no warranty, express or implied, as to the completeness, reliability, or accuracy of any information presented, and accept no liability for any loss, harm, or damage arising from its use.</p>' +
    '<h3>Not Affiliated</h3>' +
    '<p>PharmaGrid is not affiliated with, endorsed by, or officially connected to DRAP, any pharmaceutical manufacturer, or any brand named within it. All trademarks and brand names belong to their respective owners and are referenced here for identification and educational purposes only.</p>' +
    '<p>If you notice an error, please use the Contact Us page. Corrections are always welcome.</p>';

  var DMCA_HTML =
    '<h3>Copyright &amp; Content Policy</h3>' +
    '<p>PharmaGrid is a non-commercial, educational reference. Drug and brand information is compiled from publicly available packaging, leaflets, and reference material for the purpose of study and organization, and is presented factually (drug names, strengths, forms, manufacturers) rather than as reproduced copyrighted text.</p>' +
    '<p>The underlying code, design, and organization of PharmaGrid belong to its developer. If you are a rights holder and believe that content on PharmaGrid infringes your copyright, we will respond promptly and in good faith to any valid takedown request.</p>' +
    '<h3>Filing a Notice</h3>' +
    '<p>Please send an email to the address below with the following information:</p>' +
    '<ul>' +
      '<li>A description of the copyrighted work you believe is infringed</li>' +
      '<li>The specific location (page or class name) on PharmaGrid where it appears</li>' +
      '<li>Your contact information (name and email)</li>' +
      '<li>A statement that you have a good-faith belief the use is unauthorized</li>' +
      '<li>A statement, under penalty of perjury, that the information provided is accurate and that you are authorized to act on behalf of the rights holder</li>' +
    '</ul>' +
    '<h3>Email</h3>' +
    '<p><a class="mailto" href="mailto:iamzainmunawar@gmail.com">iamzainmunawar@gmail.com</a></p>' +
    '<p>Valid requests will be reviewed and, where appropriate, the material will be removed or corrected promptly.</p>';

  var PAGES = {
    about: { title: "About Me", html: ABOUT_HTML },
    contact: { title: "Contact Us", html: CONTACT_HTML },
    disclaimer: { title: "Disclaimer", html: DISCLAIMER_HTML },
    dmca: { title: "DMCA", html: DMCA_HTML }
  };

  var modal = document.getElementById("info-modal");
  var modalTitle = document.getElementById("info-modal-title");
  var modalBody = document.getElementById("info-modal-body");
  var modalClose = document.getElementById("info-modal-close");
  var dropdown = document.getElementById("mobile-nav-dropdown");
  var hamburgerBtn = document.getElementById("hamburger-btn");

  function openInfo(which, evt) {
    if (evt) evt.preventDefault();
    if (dropdown) dropdown.classList.remove("open");
    var page = PAGES[which] || PAGES.about;
    modalTitle.textContent = page.title;
    modalBody.innerHTML = page.html;
    modalBody.scrollTop = 0;
    modal.classList.add("open");
  }

  function closeInfo() {
    modal.classList.remove("open");
  }

  document.querySelectorAll("[data-info]").forEach(function (el) {
    el.addEventListener("click", function (e) { openInfo(el.getAttribute("data-info"), e); });
  });

  if (modalClose) modalClose.addEventListener("click", closeInfo);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeInfo();
  });

  if (hamburgerBtn && dropdown) {
    hamburgerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      dropdown.classList.toggle("open");
    });
    document.addEventListener("click", function (e) {
      if (dropdown.classList.contains("open") && !dropdown.contains(e.target) && e.target !== hamburgerBtn) {
        dropdown.classList.remove("open");
      }
    });
  }
})();
